import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Avaliação mútua CEGA (Fase 2.3b).
 *
 * Regras (decididas com o produto):
 *  - a avaliação abre 2h depois do código de fechamento (`closingCodeUsedAt`)
 *    e fecha 30 dias depois do mesmo instante;
 *  - a primeira avaliação do hiring fica invisível (`releasedAt = null`);
 *  - quando a segunda chega, as DUAS são liberadas com o mesmo `releasedAt`;
 *  - se só uma parte avaliar, o job diário libera a avaliação pendente em
 *    `closingCodeUsedAt + 30d` (`releaseExpiredEvaluations`);
 *  - a média (`ratingAverage`) considera SOMENTE avaliações liberadas —
 *    incluir as cegas vazaria a nota antes da hora.
 *
 * A nota de estrelas é métrica separada da confiabilidade
 * (`reliabilityService`): nunca escrevemos `reliabilityScore` aqui.
 */

const MAX_COMMENT_LENGTH = 500;
const MIN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h (mínimo pós-fechamento)
export const EVALUATION_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000; // 30d

/** Instante em que a avaliação daquela contratação desbloqueia. */
export function evaluationUnlockAt(closingCodeUsedAt: Date): Date {
  return new Date(closingCodeUsedAt.getTime() + MIN_WINDOW_MS);
}

/** Prazo final para avaliar (depois disso a janela expira). */
export function evaluationDeadlineAt(closingCodeUsedAt: Date): Date {
  return new Date(closingCodeUsedAt.getTime() + EVALUATION_DEADLINE_MS);
}

/** Erro tipado para a rota traduzir em 422 (os demais continuam 400). */
export class EvaluationDeadlineError extends Error {
  constructor() {
    super("Prazo de avaliação expirou");
    this.name = "EvaluationDeadlineError";
  }
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Recalcula a média do usuário avaliado usando APENAS avaliações liberadas.
 * Funciona dentro de uma transação (`tx`) ou com o client global.
 */
export async function recalculateRating(userId: string, db: DbClient = prisma) {
  const agg = await db.evaluation.aggregate({
    where: { targetId: userId, releasedAt: { not: null } },
    _avg: { rating: true },
  });
  const average = agg._avg.rating ?? null;

  // O mesmo usuário pode ter os dois papéis; atualizamos o que existir.
  await db.professionalProfile.updateMany({
    where: { userId },
    data: { ratingAverage: average },
  });
  await db.contractorProfile.updateMany({
    where: { userId },
    data: { ratingAverage: average },
  });

  return average;
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

  const now = new Date();
  const unlockAt = evaluationUnlockAt(hiring.closingCodeUsedAt);
  if (now < unlockAt) {
    throw new Error(
      `Avaliação mútua libera 2h após o código de fechamento (disponível em ${unlockAt.toISOString()})`
    );
  }

  // A janela é contada do fechamento, não da primeira avaliação.
  if (now > evaluationDeadlineAt(hiring.closingCodeUsedAt)) {
    throw new EvaluationDeadlineError();
  }

  const targetId =
    authorId === hiring.contractorId ? hiring.professionalId : hiring.contractorId;

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.evaluation.create({
        data: { hiringId, authorId, targetId, rating: params.rating, comment },
      });

      // Avaliação cega: a primeira nasce com releasedAt = null. Assim que
      // existem DUAS no mesmo hiring, liberamos as duas no mesmo instante.
      const all = await tx.evaluation.findMany({
        where: { hiringId },
        select: { id: true, targetId: true, releasedAt: true },
      });
      const releaseAt = all.length >= 2 ? now : null;
      if (releaseAt) {
        await tx.evaluation.updateMany({
          where: { hiringId, releasedAt: null },
          data: { releasedAt: releaseAt },
        });
      }

      // Recalcula os dois lados: a nota do alvo e (quando liberou) a do autor.
      for (const id of new Set(all.map((evaluation) => evaluation.targetId))) {
        await recalculateRating(id, tx);
      }

      return { ...created, releasedAt: releaseAt };
    });
  } catch (err) {
    // P2002 = @@unique([hiringId, authorId]) — já avaliou esta contratação.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      throw new Error("Você já avaliou esta contratação");
    }
    throw err;
  }
}

/**
 * Libera avaliações cuja janela cega venceu (30d após o fechamento).
 *
 * Idempotente: só toca linhas com `releasedAt = null`; rodar duas vezes não
 * muda nada. Chamado pelo job diário de reconciliação.
 */
export async function releaseExpiredEvaluations(): Promise<{ released: number }> {
  const cutoff = new Date(Date.now() - EVALUATION_DEADLINE_MS);

  const pending = await prisma.evaluation.findMany({
    where: {
      releasedAt: null,
      hiring: { closingCodeUsedAt: { lte: cutoff } },
    },
    select: {
      id: true,
      targetId: true,
      hiring: { select: { closingCodeUsedAt: true } },
    },
  });

  if (pending.length === 0) return { released: 0 };

  await prisma.$transaction(async (tx) => {
    for (const evaluation of pending) {
      const releasedAt = evaluationDeadlineAt(evaluation.hiring.closingCodeUsedAt!);
      await tx.evaluation.updateMany({
        where: { id: evaluation.id, releasedAt: null },
        data: { releasedAt },
      });
    }
    for (const targetId of new Set(pending.map((evaluation) => evaluation.targetId))) {
      await recalculateRating(targetId, tx);
    }
  });

  return { released: pending.length };
}

/**
 * Avaliações recebidas por um usuário (para exibir no perfil).
 * Só as liberadas: uma avaliação cega não pode vazar antes da contraparte.
 */
export async function listEvaluationsReceived(targetId: string, limit = 50) {
  const evaluations = await prisma.evaluation.findMany({
    where: { targetId, releasedAt: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      author: { select: { id: true, name: true, tradeName: true } },
      hiring: { select: { id: true, jobTitle: true } },
    },
  });
  return evaluations;
}
