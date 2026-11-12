import { prisma } from "@/lib/prisma";

const HOLDING_TIMEOUT_DAYS = 3;

export type HoldingTimeoutResult = {
  checked: number;
  flagged: { hiringId: string; daysSinceReference: number; reference: "endsAt" | "createdAt" }[];
  skipped: { hiringId: string; reason: string }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

/**
 * Detecta contratações RETIDAS há mais de HOLDING_TIMEOUT_DAYS sem revisão
 * humana e abre uma disputa administrativa (HOLDING_TIMEOUT). NUNCA move
 * dinheiro (sem LedgerEntry) e NUNCA altera Hiring.status — apenas cria Dispute
 * e registra log.
 *
 * Referência de tempo: preferimos `JobPosting.endsAt` (data prevista de término
 * do turno); se indisponível, usamos `Hiring.createdAt`. A referência usada é
 * registrada no log e no resultado.
 */
export async function checkHoldingTimeouts(): Promise<HoldingTimeoutResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - HOLDING_TIMEOUT_DAYS * DAY_MS);

  const candidatesRaw = await prisma.hiring.findMany({
    where: {
      status: "RETIDO",
      disputeOpen: false,
    },
    select: {
      id: true,
      createdAt: true,
      jobPosting: { select: { endsAt: true } },
      disputes: {
        where: { status: "EM_ANALISE" },
        select: { id: true, reason: true },
      },
    },
  });

  const candidates = candidatesRaw.filter((h) => {
    const refDate = h.jobPosting?.endsAt ?? h.createdAt;
    return refDate < cutoff;
  });

  const result: HoldingTimeoutResult = { checked: candidates.length, flagged: [], skipped: [] };

  for (const hiring of candidates) {
    try {
      const refDate = hiring.jobPosting?.endsAt ?? hiring.createdAt;
      const reference: "endsAt" | "createdAt" = hiring.jobPosting?.endsAt ? "endsAt" : "createdAt";
      const days = daysSince(refDate, now);

      // Idempotência / guarda: se já existe QUALQUER disputa aberta (EM_ANALISE),
      // não duplicar — humano/sistema já está vendo.
      const openDisputes = hiring.disputes ?? [];
      const hasTimeoutOpen = openDisputes.some((d) => d.reason === "HOLDING_TIMEOUT");
      if (openDisputes.length > 0) {
        result.skipped.push({
          hiringId: hiring.id,
          reason: hasTimeoutOpen
            ? "disputa HOLDING_TIMEOUT já aberta"
            : "disputa aberta existente (user/sistema em análise)",
        });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        // Recheca dentro da transação por corrida entre execuções.
        const existing = await tx.dispute.findFirst({
          where: { hiringId: hiring.id, status: "EM_ANALISE" },
          select: { id: true },
        });
        if (existing) {
          return; // tratado como skip pós-transação abaixo não necessário; já protegido
        }
        await tx.dispute.create({
          data: {
            hiringId: hiring.id,
            openedById: "system",
            openedBySide: "SYSTEM",
            reason: "HOLDING_TIMEOUT",
            status: "EM_ANALISE",
            decisionNote: null,
          },
        });
        await tx.hiring.update({
          where: { id: hiring.id },
          data: { disputeOpen: true },
        });
      });

      console.warn(
        `[holding-timeout] hiring=${hiring.id} days=${days} reference=${reference} refDate=${refDate.toISOString()}`
      );
      result.flagged.push({ hiringId: hiring.id, daysSinceReference: days, reference });
    } catch (err) {
      const message = err instanceof Error ? err.message : "erro desconhecido";
      result.skipped.push({ hiringId: hiring.id, reason: `erro: ${message}` });
    }
  }

  return result;
}
