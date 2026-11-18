import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { getPixTransferProvider } from "../lib/pixProvider";
import { getCompanyBalance } from "./companyWalletService";

const MIN_WITHDRAWAL_CENTS = 2000; // R$ 20,00

export type WithdrawOutcome =
  | { kind: "ok"; withdrawalId: string; providerTransferId: string | null }
  | { kind: "insufficient"; availableCents: number; requiredCents: number }
  | { kind: "below_minimum"; minimumCents: number }
  | { kind: "invalid_amount" }
  | { kind: "invalid_pix_key" }
  | { kind: "chargeback_blocked" }
  | { kind: "transfer_failed"; message: string };

/**
 * Saque da carteira da empresa via Pix.
 *
 * Ordem (segue o padrão de payoutService.releasePayout):
 * 1. $transaction: trava a carteira, checa chargeback ativo, debita e cria o
 *    registro CompanyWithdrawal (PROCESSING).
 * 2. Fora da tx: chama pixProvider.transfer (a chamada real ao Asaas).
 * 3. Sucesso → CompanyWithdrawal COMPLETED + providerTransferId.
 * 4. Falha → ADJUSTMENT positivo (devolve o saldo) + CompanyWithdrawal FAILED.
 */
export async function withdrawCompanyBalance(params: {
  contractorId: string;
  amountCents: number;
  pixKey: string;
}): Promise<WithdrawOutcome> {
  const { contractorId, amountCents, pixKey } = params;

  if (!Number.isInteger(amountCents) || amountCents <= 0) return { kind: "invalid_amount" };
  if (amountCents < MIN_WITHDRAWAL_CENTS) {
    return { kind: "below_minimum", minimumCents: MIN_WITHDRAWAL_CENTS };
  }
  const trimmedPixKey = pixKey.trim();
  if (!trimmedPixKey || trimmedPixKey.length < 5) return { kind: "invalid_pix_key" };

  const withdrawalId = `wd_${randomUUID()}`;
  const idempotencyKey = `withdrawal:${withdrawalId}`;

  // 1. Transação: guard chargeback + debita + cria registro
  try {
    await prisma.$transaction(async (tx) => {
      // Advisory lock por contractorId — serializa saques e pagamentos da mesma empresa.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`company-wallet:${contractorId}`}, 0))`;

      // Guard chargeback — query direta (ChargebackEvent não tem contractorId).
      const activeChargeback = await tx.chargebackEvent.findFirst({
        where: { hiring: { contractorId }, state: "ATIVO" },
        select: { id: true },
      });
      if (activeChargeback) throw new Error("chargeback_active");

      const available = await getCompanyBalance(contractorId, tx);
      if (available < amountCents) throw new Error(`insufficient:${available}:${amountCents}`);

      await tx.companyWalletEntry.create({
        data: {
          contractorId,
          hiringId: null,
          type: "WITHDRAWAL_DEBIT",
          amountCents,
          reason: `saque para ${trimmedPixKey}`,
          createdBy: "system",
          idempotencyKey,
        },
      });

      await tx.companyWithdrawal.create({
        data: {
          id: withdrawalId,
          contractorId,
          amountCents,
          pixKey: trimmedPixKey,
          status: "PROCESSING",
          idempotencyKey,
        },
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "chargeback_active") return { kind: "chargeback_blocked" };
    if (msg.startsWith("insufficient:")) {
      const [, availableStr, requiredStr] = msg.split(":");
      return {
        kind: "insufficient",
        availableCents: Number(availableStr),
        requiredCents: Number(requiredStr),
      };
    }
    throw err;
  }

  // 2. Chamar Asaas FORA da transação (padrão releasePayout).
  let providerTransferId: string | null = null;
  let transferError: string | null = null;
  try {
    const provider = getPixTransferProvider();
    const result = await provider.transfer({
      pixKey: trimmedPixKey,
      amountCents, // o adapter do pixProvider converte para valueCents do Asaas
      idempotencyKey,
      description: "Saque carteira Freelaz",
    });
    if (result.success) providerTransferId = result.transferId ?? null;
    else transferError = result.errorMessage ?? "transferência recusada";
  } catch (err) {
    transferError = err instanceof Error ? err.message : "erro de rede";
  }

  // 3/4. Sucesso ou rollback
  if (!transferError) {
    await prisma.companyWithdrawal.update({
      where: { id: withdrawalId },
      data: { status: "COMPLETED", providerTransferId },
    });
    return { kind: "ok", withdrawalId, providerTransferId };
  }

  // Falha: ADJUSTMENT positivo devolve o saldo + marca FAILED.
  await prisma.$transaction(async (tx) => {
    await tx.companyWalletEntry.create({
      data: {
        contractorId,
        hiringId: null,
        type: "ADJUSTMENT",
        amountCents, // positivo = crédito
        reason: `estorno saque falhou: ${transferError}`,
        createdBy: "system",
      },
    });
    await tx.companyWithdrawal.update({
      where: { id: withdrawalId },
      data: { status: "FAILED", failureReason: transferError },
    });
  });

  return { kind: "transfer_failed", message: transferError };
}
