import { prisma } from "../lib/prisma";
import { LedgerEntryType } from "@prisma/client";
import type { Db } from "../lib/db";

/**
 * GOVERNANÇA FINANCEIRA (ver CLAUDE.md):
 * - O saldo retido nunca é "um número" guardado solto — é sempre a soma de
 *   LedgerEntry para aquela contratação. Isso dá rastreabilidade total.
 * - createdBy é sempre "system" (evento automático) ou o id de um admin em
 *   uma decisão de disputa auditada — nunca uma string livre.
 *
 * Todas as funções aceitam um `db` opcional para rodar DENTRO da mesma
 * transação do evento que as originou (pagamento aprovado, cancelamento).
 * Sem isso, o lançamento no ledger podia ser gravado mesmo se a transação
 * principal falhasse — dinheiro registrado a partir de um evento que não
 * aconteceu.
 */

export async function recordRetention(
  hiringId: string,
  amountCents: number,
  db: Db = prisma
) {
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.RETENCAO,
      amountCents,
      reason: "payment_approved",
      createdBy: "system",
    },
  });
}

export async function recordRelease(
  hiringId: string,
  amountCents: number,
  reason: string,
  createdBy: string = "system",
  db: Db = prisma
) {
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.LIBERACAO,
      amountCents,
      reason,
      createdBy,
    },
  });
}

export async function recordRefund(
  hiringId: string,
  amountCents: number,
  reason: string,
  createdBy: string,
  db: Db = prisma
) {
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.REEMBOLSO,
      amountCents,
      reason,
      createdBy,
    },
  });
}

/**
 * REGRA ÚNICA de saldo de um conjunto de lançamentos: RETENCAO soma,
 * LIBERACAO e REEMBOLSO subtraem, AJUSTE não entra automaticamente (exige
 * revisão humana). Fica numa função só porque é a mesma conta usada no saldo
 * por contratação, no total da plataforma e na reconciliação diária — se
 * divergissem, a reconciliação acusaria uma diferença que não existe.
 */
export function computeRetainedBalance(
  entries: { type: string; amountCents: number }[]
): number {
  return entries.reduce((total, entry) => {
    if (entry.type === "RETENCAO") return total + entry.amountCents;
    if (entry.type === "LIBERACAO" || entry.type === "REEMBOLSO") {
      return total - entry.amountCents;
    }
    return total;
  }, 0);
}

/** Saldo retido ATUAL de uma contratação específica, calculado a partir do ledger. */
export async function getRetainedBalance(hiringId: string, db: Db = prisma): Promise<number> {
  const entries = await db.ledgerEntry.findMany({ where: { hiringId } });
  return computeRetainedBalance(entries);
}

/** Soma de TODO saldo retido na plataforma — usado na reconciliação diária. */
export async function getTotalRetainedOnPlatform(): Promise<number> {
  const entries = await prisma.ledgerEntry.findMany();
  return computeRetainedBalance(entries);
}
