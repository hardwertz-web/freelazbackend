import { prisma } from "../lib/prisma";
import { recordRefund, getRetainedBalance } from "./ledgerService";
import { reopenJobPosting } from "./jobPostingService";
import { setHiringStatus } from "./hiringService";

/**
 * Caminho ÚNICO de encerramento de uma contratação paga, antes da conclusão
 * (ver CLAUDE.md > "Lista de suplentes e cancelamento"). Cobre tanto a
 * desistência do profissional quanto o desacordo entre as partes pelo
 * chat — os dois casos usam exatamente a mesma política de cancelamento
 * assimétrica já existente para decidir multa/reembolso/nota. Não existe
 * um segundo caminho "neutro" separado.
 *
 * O cálculo de quem paga multa, quanto, e qual nota automática o
 * profissional recebe é feito pelo módulo de política de cancelamento
 * (fora deste arquivo) ANTES de chamar esta função — aqui só executamos
 * o resultado já decidido: reembolso (se houver) e reabertura da vaga.
 */
export async function cancelHiring(params: {
  hiringId: string;
  initiatedBy: string; // id do usuário que disparou o encerramento, ou "system"
  refundAmountCents: number; // calculado pela política de cancelamento (0 a 100% do valor)
  reasonNote?: string; // texto livre opcional (ex: "desistência", "desacordo no chat")
}) {
  const { hiringId, initiatedBy, refundAmountCents, reasonNote } = params;

  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.status === "CONCLUIDO" || hiring.status === "LIBERADO") {
    throw new Error("Não é possível cancelar uma contratação já concluída/liberada");
  }

  const retained = await getRetainedBalance(hiringId);
  if (refundAmountCents > retained) {
    throw new Error("Valor de reembolso maior que o saldo retido disponível");
  }

  await prisma.$transaction(async (tx) => {
    if (refundAmountCents > 0) {
      await recordRefund(
        hiringId,
        refundAmountCents,
        reasonNote ?? "Cancelamento",
        initiatedBy,
        tx
      );
    }

    await tx.application.update({
      where: { id: hiring.applicationId },
      data: { status: "DESISTIU" },
    });

    // Único ponto que encerra a contratação — também encerra o chat
    // automaticamente (ver hiringService/chatService).
    await setHiringStatus(tx, hiringId, "CANCELADO", {
      closeReason: reasonNote ?? "cancelamento",
    });
  });

  await reopenJobPosting(hiring.jobPostingId);

  // A multa financeira (se houver) e a nota automática do profissional
  // (se aplicável) já devem ter sido aplicadas pelo módulo de política de
  // cancelamento antes de chamar esta função.
}
