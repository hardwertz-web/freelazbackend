import { prisma } from "../lib/prisma";
import { lockHiringForUpdate, setHiringStatus } from "./hiringService";
import {
  recordRetention,
  recordServiceFee,
  recordWithdrawalFee,
} from "./ledgerService";
import { getCompanyBalance } from "./companyWalletService";

/**
 * Fase 3 — pagamento de uma contratação com o saldo interno da empresa.
 *
 * O efeito final é idêntico ao webhook Asaas aprovado (vaga PREENCHIDA,
 * contratação RETIDO, retenção no ledger e fees do modelo NEW), mas sem
 * cobrança externa: o dinheiro já está na carteira da empresa.
 *
 * Segurança concorrente, em camadas:
 * 1. `idempotencyKey = hiring:${hiringId}` — um único HIRING_DEBIT por
 *    contratação (retry do mesmo pagamento é no-op).
 * 2. `SELECT ... FOR UPDATE` na contratação — serializa webhook x wallet na
 *    mesma hiring.
 * 3. `pg_advisory_xact_lock` por empresa — serializa contratações DISTINTAS
 *    da mesma empresa, para duas compras simultâneas não estourarem o saldo.
 * 4. Checagem de saldo dentro da transação (autoridade) — o fail-fast fora
 *    dela só evita abrir tx quando já está claro que não há saldo.
 */
export type WalletPaymentOutcome =
  | { kind: "ok"; alreadyPaid: boolean }
  | {
      kind: "insufficient";
      availableCents: number;
      requiredCents: number;
      missingCents: number;
    }
  | { kind: "wrong_status"; status: string }
  | { kind: "not_found" };

export async function payHiringWithWallet(params: {
  hiringId: string;
  contractorId: string;
}): Promise<WalletPaymentOutcome> {
  const { hiringId, contractorId } = params;

  // Idempotência ANTES da transação: se já existe HIRING_DEBIT para esta
  // contratação, retornar success.
  const existing = await prisma.companyWalletEntry.findUnique({
    where: { idempotencyKey: `hiring:${hiringId}` },
  });
  if (existing) {
    return { kind: "ok", alreadyPaid: true };
  }

  const hiring = await prisma.hiring.findUnique({
    where: { id: hiringId },
    select: {
      id: true,
      contractorId: true,
      status: true,
      grossValueCents: true,
      taxModel: true,
      totalChargedCents: true,
      serviceFeeCents: true,
      estimatedWithdrawalFeeCents: true,
      jobPostingId: true,
    },
  });
  if (!hiring) return { kind: "not_found" };
  if (hiring.contractorId !== contractorId) return { kind: "not_found" };
  if (hiring.status !== "AGUARDANDO_PAGAMENTO") {
    return { kind: "wrong_status", status: hiring.status };
  }

  const chargeAmountCents =
    hiring.taxModel === "NEW"
      ? hiring.totalChargedCents ?? hiring.grossValueCents
      : hiring.grossValueCents;

  // Fail-fast: fora da transação, apenas para não abri-la à toa. A decisão
  // final é a checagem dentro da tx, depois do lock e do advisory lock.
  const fastAvailableCents = await getCompanyBalance(contractorId);
  if (fastAvailableCents < chargeAmountCents) {
    return {
      kind: "insufficient",
      availableCents: fastAvailableCents,
      requiredCents: chargeAmountCents,
      missingCents: chargeAmountCents - fastAvailableCents,
    };
  }

  // Transação atômica: débito + status + ledger + PREENCHIDA.
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await lockHiringForUpdate(tx, hiringId);
      if (!locked) throw new Error("hiring_not_found_after_lock");
      if (locked.status !== "AGUARDANDO_PAGAMENTO") {
        throw new Error(`wrong_status:${locked.status}`);
      }

      // ⚠️ Advisory lock por contractorId — serializa TODAS as operações de
      // carteira da mesma empresa. Sem isso, 2 contratações simultâneas da
      // mesma empresa podem ambas ler saldo suficiente e estourar a carteira.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`company-wallet:${contractorId}`}, 0))`;

      const availableCents = await getCompanyBalance(contractorId, tx);
      if (availableCents < chargeAmountCents) {
        throw new Error(`insufficient:${availableCents}:${chargeAmountCents}`);
      }

      // 1. Debita o saldo
      await tx.companyWalletEntry.create({
        data: {
          contractorId,
          hiringId,
          type: "HIRING_DEBIT",
          amountCents: chargeAmountCents,
          reason: `pagamento com saldo: ${locked.jobTitle}`,
          createdBy: "system",
          idempotencyKey: `hiring:${hiringId}`,
        },
      });

      // 2. Vaga some do marketplace
      await tx.jobPosting.update({
        where: { id: hiring.jobPostingId },
        data: { status: "PREENCHIDA" },
      });

      // 3. Status + retenção (setHiringStatus já abre o chat)
      await setHiringStatus(tx, hiringId, "RETIDO", {});
      await recordRetention(hiringId, locked.grossValueCents, tx);

      // 4. Fees NEW (mesma lógica do webhook)
      if (locked.taxModel === "NEW") {
        if ((locked.serviceFeeCents ?? 0) > 0) {
          await recordServiceFee(hiringId, locked.serviceFeeCents!, tx);
        }
        if ((locked.estimatedWithdrawalFeeCents ?? 0) > 0) {
          await recordWithdrawalFee(
            hiringId,
            locked.estimatedWithdrawalFeeCents!,
            tx
          );
        }
      }
    });
    return { kind: "ok", alreadyPaid: false };
  } catch (err) {
    // Corrida: outro request já criou o HIRING_DEBIT (P2002 no idempotencyKey)
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return { kind: "ok", alreadyPaid: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("wrong_status:")) {
      return { kind: "wrong_status", status: msg.split(":")[1] };
    }
    if (msg.startsWith("insufficient:")) {
      const [, availableStr, requiredStr] = msg.split(":");
      const availableCents = Number(availableStr);
      const requiredCents = Number(requiredStr);
      return {
        kind: "insufficient",
        availableCents,
        requiredCents,
        missingCents: requiredCents - availableCents,
      };
    }
    if (msg === "hiring_not_found_after_lock") {
      return { kind: "not_found" };
    }
    throw err;
  }
}
