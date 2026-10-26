import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createEvaluation, EvaluationDeadlineError } from "@/services/evaluationService";

/**
 * POST /api/evaluations — avaliação mútua CEGA (1 a 5 estrelas + comentário),
 * UMA vez por parte por contratação, liberada 2h após o uso do código de
 * fechamento (fluxograma X7 → AV1) e com prazo máximo de 30 dias. O autor vem
 * SEMPRE da sessão. A 2ª avaliação do hiring libera as duas.
 *
 * Body: { hiringId, rating: 1..5, comment?: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: o required abaixo causa 400 com mensagem clara
  }
  const hiringId = typeof body.hiringId === "string" ? body.hiringId : null;
  if (!hiringId) {
    return NextResponse.json({ error: "hiringId é obrigatório" }, { status: 400 });
  }

  try {
    const evaluation = await createEvaluation({
      hiringId,
      authorId: auth.user.id,
      rating: typeof body.rating === "number" ? body.rating : NaN,
      comment: typeof body.comment === "string" ? body.comment : null,
    });
    return NextResponse.json({ evaluation }, { status: 201 });
  } catch (err) {
    // Prazo de 30d vencido é 422 (regra de negócio); os demais erros seguem
    // no 400 histórico para não quebrar clientes existentes.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao avaliar" },
      { status: err instanceof EvaluationDeadlineError ? 422 : 400 }
    );
  }
}
