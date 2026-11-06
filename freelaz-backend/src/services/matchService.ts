import { prisma } from "../lib/prisma";
import { recordRefund, recordRelease } from "./ledgerService";
import { reopenJobPosting } from "./jobPostingService";
import { setHiringStatus } from "./hiringService";
import { hasActiveChargeback } from "./asaasEventService";
import { applyCancellationPenalty } from "./evaluationService";

type CancelOrigin = "CONTRACTOR" | "PROFESSIONAL" | "SYSTEM" | "FORCE_MAJEURE";

function hoursUntil(startsAt: Date, now: Date): number {
  return (startsAt.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function calculateCancellationFee(
  hiring: { grossValueCents: number },
  origin: CancelOrigin,
  hoursUntilStart: number
): { feeCents: number; feePercent: number } {
  // Força maior / sistema / profissional: sem multa financeira
  if (origin === "FORCE_MAJEURE" || origin === "SYSTEM" || origin === "PROFESSIONAL") {
    return { feeCents: 0, feePercent: 0 };
  }

  // Contratante: multa por prazo (hoursUntilStart pode ser negativo se o turno já passou)
  if (hoursUntilStart > 24) return { feeCents: 0, feePercent: 0 };
  if (hoursUntilStart >= 2) {
    return {
      feeCents: Math.round(hiring.grossValueCents * 0.3),
      feePercent: 30,
    };
  }
  return { feeCents: hiring.grossValueCents, feePercent: 100 };
}

/**
 * Caminho ÚNICO de encerramento de uma contratação paga, antes da conclusão
 * (ver CLAUDE.md > "Lista de suplentes e cancelamento"). Cobre desistência do
 * profissional e desacordo entre as partes pelo chat — mesma política.
 *
 * Calcula a multa pelo prazo/origem, aplica proteções, persiste auditoria no
 * Hiring e registra os lançamentos no ledger (append-only):
 * - 100% multa (contratante <2h): LIBERACAO = gross, sem REEMBOLSO
 * - 30% multa: REEMBOLSO = gross-fee, LIBERACAO = fee
 * - 0%: REEMBOLSO = gross
 * Usa LIBERACAO (reason "multa de cancelamento: <percent>%") para a multa — não AJUSTE.
 *
 * Nota automática (cancelamento do profissional): aplicada APÓS a transação
 * (falha não reverte o cancelamento já persistido).
 */
export async function cancelHiring(params: {
  hiringId: string;
  origin: CancelOrigin;
  reason?: string;
}): Promise<{ feeCents: number; refundCents: number; feePercent: number }> {
  const { hiringId, origin, reason } = params;
  const now = new Date();

  const hiring = await prisma.hiring.findUnique({
    where: { id: hiringId },
    include: { jobPosting: { select: { startsAt: true } } },
  });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.status === "CONCLUIDO" || hiring.status === "LIBERADO") {
    throw new Error("Não é possível cancelar uma contratação já concluída/liberada");
  }
  if (hiring.disputeOpen) throw new Error("Há disputa aberta — admin deve decidir");

  const hoursUntilStart = hoursUntil(hiring.jobPosting.startsAt, now);
  const { feeCents, feePercent } = calculateCancellationFee(
    { grossValueCents: hiring.grossValueCents },
    origin,
    hoursUntilStart
  );
  const refundCents = hiring.grossValueCents - feeCents;
  const reasonNote = reason?.trim() ? reason.trim().slice(0, 500) : "Cancelamento";

  await prisma.$transaction(async (tx) => {
    if (await hasActiveChargeback(tx, hiringId)) {
      throw new Error("Há chargeback ativo — resolva pelo admin antes");
    }

    await tx.hiring.update({
      where: { id: hiringId },
      data: {
        cancelReason: reasonNote,
        cancelOrigin: origin,
        canceledAt: now,
        cancellationFeeCents: feeCents,
        cancellationFeePercent: feePercent,
      },
    });

    if (feePercent === 100) {
      await recordRelease(
        hiringId,
        hiring.grossValueCents,
        `multa de cancelamento: ${feePercent}%`,
        "system",
        tx
      );
    } else if (feePercent === 30) {
      await recordRefund(hiringId, refundCents, reasonNote, "system", tx);
      await recordRelease(
        hiringId,
        feeCents,
        `multa de cancelamento: ${feePercent}%`,
        "system",
        tx
      );
    } else {
      // 0%: reembolso integral (comportamento histórico)
      await recordRefund(hiringId, hiring.grossValueCents, reasonNote, "system", tx);
    }

    await tx.application.update({
      where: { id: hiring.applicationId },
      data: { status: "DESISTIU" },
    });

    // Único ponto que encerra a contratação — também encerra o chat
    // automaticamente (ver hiringService/chatService).
    await setHiringStatus(tx, hiringId, "CANCELADO", {
      closeReason: reasonNote,
    });
  });

  // Nota automática (profissional): APÓS a transação — falha não reverte cancelamento.
  try {
    await applyCancellationPenalty(prisma, hiringId, origin, hoursUntilStart);
  } catch (err) {
    console.warn(
      `[penalty] falha ao aplicar nota automática (hiring ${hiringId}):`,
      err instanceof Error ? err.message : err
    );
  }

  await reopenJobPosting(hiring.jobPostingId);

  return { feeCents, refundCents, feePercent };
}
