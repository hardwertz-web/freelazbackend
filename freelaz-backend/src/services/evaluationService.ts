import { prisma } from "../lib/prisma";

/**
 * Avaliação mútua (fluxograma: "2h depois → avaliação mútua libera → 1 a 5
 * estrelas + comentário"). Cada parte avalia a outra UMA vez por
 * contratação, somente após a conclusão E após a janela de 2h que começa no
 * uso do código de fechamento (`closingCodeUsedAt`).
 *
 * A nota de estrelas atualiza `ratingAverage` do perfil avaliado (média de
 * todas as avaliações recebidas) — e NÃO toca na confiabilidade, que é
 * métrica separada (reliabilityService).
 */

const MAX_COMMENT_LENGTH = 500;
const EVALUATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h

/** Instante em que a avaliação daquela contratação desbloqueia. */
export function evaluationUnlockAt(closingCodeUsedAt: Date): Date {
  return new Date(closingCodeUsedAt.getTime() + EVALUATION_WINDOW_MS);
}

export async function createEvaluation(params: {
  hiringId: string;
  authorId: string;
  rating: number;
  comment?: string | null;
}) {
  const { hiringId, authorId } = params;

  if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
    throw new Error("rating deve ser um inteiro de 1 a 5 (estrelas)");
  }
  const comment = params.comment?.trim() || null;
  if (comment && comment.length > MAX_COMMENT_LENGTH) {
    throw new Error(`comentário muito longo (máximo ${MAX_COMMENT_LENGTH} caracteres)`);
  }

  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.contractorId !== authorId && hiring.professionalId !== authorId) {
    throw new Error("Você não participa desta contratação");
  }
  if (hiring.status !== "CONCLUIDO" && hiring.status !== "LIBERADO") {
    throw new Error("Avaliação disponível somente após a conclusão do serviço");
  }
  if (!hiring.closingCodeUsedAt) {
    throw new Error("Sem código de fechamento confirmado não há avaliação");
  }
  const unlockAt = evaluationUnlockAt(hiring.closingCodeUsedAt);
  if (new Date() < unlockAt) {
    throw new Error(
      `Avaliação mútua libera 2h após o código de fechamento (disponível em ${unlockAt.toISOString()})`
    );
  }

  const targetId =
    authorId === hiring.contractorId ? hiring.professionalId : hiring.contractorId;

  try {
    const evaluation = await prisma.$transaction(async (tx) => {
      const created = await tx.evaluation.create({
        data: { hiringId, authorId, targetId, rating: params.rating, comment },
      });
      // Média recalculada na MESMA transação: a nota exibida nunca fica
      // defasada em relação à avaliação que acabou de entrar.
      const agg = await tx.evaluation.aggregate({
        where: { targetId },
        _avg: { rating: true },
        _count: { rating: true },
      });
      const average = agg._avg.rating ?? null;
      await tx.professionalProfile.updateMany({
        where: { userId: targetId },
        data: { ratingAverage: average },
      });
      await tx.contractorProfile.updateMany({
        where: { userId: targetId },
        data: { ratingAverage: average },
      });
      return created;
    });
    return evaluation;
  } catch (err) {
    // P2002 = @@unique([hiringId, authorId]) — já avaliou esta contratação.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      throw new Error("Você já avaliou esta contratação");
    }
    throw err;
  }
}

/** Avaliações recebidas por um usuário (para exibir no perfil). */
export async function listEvaluationsReceived(targetId: string, limit = 50) {
  const evaluations = await prisma.evaluation.findMany({
    where: { targetId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      author: { select: { id: true, name: true, tradeName: true } },
      hiring: { select: { id: true, jobTitle: true } },
    },
  });
  return evaluations;
}
