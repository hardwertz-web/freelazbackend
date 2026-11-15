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
 * Etapa 7.3d — receita da plataforma no modelo NEW: a comissão e a taxa de
 * saque estimada que a EMPRESA pagou a mais. Não é saldo retido (não entra em
 * `computeRetainedBalance`), por isso nunca é repassado ao profissional.
 *
 * @deprecated (backlog #2) — não usar em código novo.
 * Modelo NEW agora emite SERVICE_FEE + WITHDRAWAL_FEE separados.
 * Mantido para compatibilidade e para scripts legados.
 */
export async function recordPlatformRevenue(
  hiringId: string,
  amountCents: number,
  db: Db = prisma
) {
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.RECEITA_PLATAFORMA,
      amountCents,
      reason: "taxa_empresa_paga",
      createdBy: "system",
    },
  });
}

/**
 * Backlog #2 — comissão da plataforma no modelo NEW (empresa paga por cima).
 * Separado de WITHDRAWAL_FEE para o painel Métricas distinguir "comissão de
 * serviço" de "taxa de saque estimada".
 */
export async function recordServiceFee(
  hiringId: string,
  amountCents: number,
  db: Db = prisma
) {
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.SERVICE_FEE,
      amountCents,
      reason: "service_fee_empresa_paga",
      createdBy: "system",
    },
  });
}

/**
 * Backlog #2 — taxa de saque estimada que a empresa paga a mais no modelo NEW.
 * O valor real da taxa do saque só é conhecido no saque; esta é a estimativa
 * do momento da cobrança. Diferenças são conciliadas em WITHDRAWAL_FEE real
 * quando o saque acontece (fora do escopo deste backlog).
 */
export async function recordWithdrawalFee(
  hiringId: string,
  amountCents: number,
  db: Db = prisma
) {
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.WITHDRAWAL_FEE,
      amountCents,
      reason: "withdrawal_fee_estimada",
      createdBy: "system",
    },
  });
}

/**
 * AJUSTE manual — correção auditada de divergência de reconciliação.
 * amountCents é SEMPRE positivo (nunca negativo). direction/reason carregam o
 * contexto (release ao profissional vs refund à empresa) e vão na `reason`.
 * createdBy é SEMPRE o id do admin — "system" é proibido aqui: sem revisão
 * humana identificada, não existe ajuste.
 *
 * O AJUSTE NÃO entra em `computeRetainedBalance` (saldo operacional, usado
 * para mover dinheiro). Ele só aparece em `computeAdjustedBalance`, que é
 * contábil e serve à reconciliação/painel.
 */
export async function recordAdjustment(
  hiringId: string,
  amountCents: number,
  reason: string,
  createdBy: string,
  db: Db = prisma
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("amountCents do AJUSTE deve ser inteiro positivo");
  }
  if (createdBy === "system" || !createdBy.trim()) {
    throw new Error("AJUSTE exige admin identificado (createdBy não pode ser 'system')");
  }
  return db.ledgerEntry.create({
    data: {
      hiringId,
      type: LedgerEntryType.AJUSTE,
      amountCents,
      reason,
      createdBy,
    },
  });
}

/**
 * REGRA ÚNICA de saldo de um conjunto de lançamentos: RETENCAO soma,
 * LIBERACAO e REEMBOLSO subtraem, AJUSTE não entra automaticamente (exige
 * revisão humana) e RECEITA_PLATAFORMA também não (é receita da empresa no
 * modelo NEW, não dinheiro do profissional). Fica numa função só porque é a
 * mesma conta usada no saldo por contratação, no total da plataforma e na
 * reconciliação diária — se divergissem, a reconciliação acusaria uma
 * diferença que não existe.
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

/**
 * Saldo AJUSTADO = operacional - sum(AJUSTE). Uso EXCLUSIVO em
 * reconciliação/dashboard (leitura contábil). NUNCA usar em fluxo que move
 * dinheiro (disputeService, webhooks do Asaas) — esses usam
 * `computeRetainedBalance`, o saldo operacional.
 *
 * A distinção existe porque o AJUSTE é uma correção de registro, não dinheiro
 * novo na conta: se entrasse no saldo operacional, uma disputa futura
 * devolveria/liberaria um valor que a plataforma nunca reteve de fato.
 */
export function computeAdjustedBalance(
  entries: { type: string; amountCents: number }[]
): number {
  const operational = computeRetainedBalance(entries);
  const adjustments = entries
    .filter((entry) => entry.type === "AJUSTE")
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  return operational - adjustments;
}

/** Saldo ajustado (operacional - AJUSTE) de uma contratação. Só leitura contábil. */
export async function getAdjustedBalance(
  hiringId: string,
  db: Db = prisma
): Promise<number> {
  const entries = await db.ledgerEntry.findMany({ where: { hiringId } });
  return computeAdjustedBalance(entries);
}

/** Soma de TODO saldo retido na plataforma — usado na reconciliação diária. */
export async function getTotalRetainedOnPlatform(): Promise<number> {
  const entries = await prisma.ledgerEntry.findMany();
  return computeRetainedBalance(entries);
}
