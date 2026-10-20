import { prisma } from "../lib/prisma";
import type { Db } from "../lib/db";

/**
 * D8 = A2 — escalonamento de chargebacks próximos/vencidos do prazo
 * (decisão aprovada pelo usuário em 2026-10-20; ver .protocol/decisions/D1-D8.md).
 *
 * O que faz: lê os `ChargebackEvent` ATIVOS que têm prazo conhecido
 * (`deadlineToSendDisputeDocuments`, data limite para enviar documentos da
 * disputa ao provedor) e classifica em:
 *   - `vencendo`: prazo ainda no FUTURO, dentro da janela de aviso (default 3
 *     dias) — o humano precisa agir;
 *   - `vencidos`: prazo já passou e o chargeback segue ATIVO — situação crítica.
 *
 * O que NÃO faz (regras não negociáveis de D8=A2 / D6):
 *   - **NÃO encerra** o chargeback (encerrar por prazo seria D6=A3, rejeitado);
 *   - **NÃO altera** `state`, `disputeOpen` nem qualquer estado;
 *   - **NÃO cria** lançamento no ledger nem move dinheiro;
 *   - **NÃO** chama o provedor (Asaas real).
 *
 * É somente leitura: serve para VISIBILIDADE/ALERTA. O encerramento só acontece
 * por desfecho verificado (D6=A2) ou decisão humana.
 */

export type EscalationItem = {
  chargebackId: string;
  hiringId: string | null;
  externalStatus: string;
  deadline: string; // ISO
  diasRestantes: number; // negativo quando já venceu
};

export type EscalationResult = {
  vencendo: EscalationItem[];
  vencidos: EscalationItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela (em dias) para considerar um prazo "vencendo". */
export const ESCALATION_WINDOW_DAYS = 3;

export async function escalateChargebacksNearDeadline(
  db: Db = prisma,
  windowDays: number = ESCALATION_WINDOW_DAYS,
  now: Date = new Date()
): Promise<EscalationResult> {
  // Somente ATIVOS e com prazo conhecido. Ordena pelo prazo mais próximo.
  const rows = await db.chargebackEvent.findMany({
    where: { state: "ATIVO", deadlineToSendDisputeDocuments: { not: null } },
    orderBy: { deadlineToSendDisputeDocuments: "asc" },
    select: {
      id: true,
      hiringId: true,
      externalStatus: true,
      deadlineToSendDisputeDocuments: true,
    },
  });

  const vencendo: EscalationItem[] = [];
  const vencidos: EscalationItem[] = [];

  for (const row of rows) {
    const deadline = row.deadlineToSendDisputeDocuments as Date;
    // Dias restantes arredondados para baixo (prazo no passado => negativo).
    const diasRestantes = Math.floor((deadline.getTime() - now.getTime()) / DAY_MS);
    const item: EscalationItem = {
      chargebackId: row.id,
      hiringId: row.hiringId,
      externalStatus: row.externalStatus,
      deadline: deadline.toISOString(),
      diasRestantes,
    };
    if (diasRestantes < 0) {
      vencidos.push(item);
    } else if (diasRestantes <= windowDays) {
      vencendo.push(item);
    }
  }

  return { vencendo, vencidos };
}
