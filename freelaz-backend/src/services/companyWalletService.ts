import { prisma } from "../lib/prisma";
import type { Db } from "../lib/db";
import type { CompanyWalletEntryType } from "@prisma/client";

/**
 * Carteira da empresa — saldo interno para reembolsos e créditos.
 * Append-only. Saldo = SUM(amountCents com sinal), nunca coluna.
 */

const SIGN: Record<CompanyWalletEntryType, 1 | -1> = {
  REFUND_CREDIT: 1,
  ADJUSTMENT: 1, // pode ser positivo ou negativo — ver signedAmountCents abaixo
  HIRING_DEBIT: -1,
  WITHDRAWAL_DEBIT: -1,
};

type EntryLike = { type: CompanyWalletEntryType; amountCents: number };

/**
 * ADJUSTMENT é o único tipo que pode nascer com valor negativo (estorno de um
 * crédito indevido); nesse caso o próprio sinal do valor decide. Os demais
 * tipos são sempre gravados como valor absoluto e o tipo define a direção.
 */
function signedAmountCents(entry: EntryLike): number {
  if (entry.type === "ADJUSTMENT") return entry.amountCents;
  return SIGN[entry.type] * Math.abs(entry.amountCents);
}

export function computeBalance(entries: EntryLike[]): number {
  return entries.reduce((sum, entry) => sum + signedAmountCents(entry), 0);
}

export async function getCompanyBalance(contractorId: string, db: Db = prisma): Promise<number> {
  const entries = await db.companyWalletEntry.findMany({
    where: { contractorId },
    select: { type: true, amountCents: true },
  });
  return computeBalance(entries);
}

export async function recordRefundCredit(
  contractorId: string,
  hiringId: string,
  amountCents: number,
  reason: string,
  db: Db = prisma
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("amountCents do REFUND_CREDIT deve ser inteiro positivo");
  }
  return db.companyWalletEntry.create({
    data: {
      contractorId,
      hiringId,
      type: "REFUND_CREDIT",
      amountCents,
      reason,
      createdBy: "system",
    },
  });
}

export async function getCompanyStatement(
  contractorId: string,
  limit = 50
): Promise<{
  availableCents: number;
  creditedCents: number;
  debitedCents: number;
  entries: any[];
}> {
  const [entries, allForBalance] = await Promise.all([
    prisma.companyWalletEntry.findMany({
      where: { contractorId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { hiring: { select: { id: true, jobTitle: true } } },
    }),
    prisma.companyWalletEntry.findMany({
      where: { contractorId },
      select: { type: true, amountCents: true },
    }),
  ]);
  const availableCents = computeBalance(allForBalance);
  const creditedCents = allForBalance
    .map(signedAmountCents)
    .filter((amount) => amount > 0)
    .reduce((sum, amount) => sum + amount, 0);
  const debitedCents = allForBalance
    .map(signedAmountCents)
    .filter((amount) => amount < 0)
    .reduce((sum, amount) => sum - amount, 0);
  return { availableCents, creditedCents, debitedCents, entries };
}
