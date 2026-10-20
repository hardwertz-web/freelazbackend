import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createReport } from "@/services/reportService";

/**
 * POST /api/reports — denúncia de comportamento (fila separada das disputas;
 * abuso entra com prioridade ALTA). Qualquer usuário logado pode denunciar;
 * denúncia NUNCA move dinheiro.
 *
 * Body: { reportedId, hiringId?, category: ABUSO|FRAUDE|NAO_COMPARECEU|OUTRO, description }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: os required abaixo causam 400 com mensagem clara
  }
  const reportedId = typeof body.reportedId === "string" ? body.reportedId : null;
  if (!reportedId) {
    return NextResponse.json({ error: "reportedId é obrigatório" }, { status: 400 });
  }

  try {
    const report = await createReport({
      reporterId: auth.user.id,
      reportedId,
      hiringId: typeof body.hiringId === "string" ? body.hiringId : null,
      category: typeof body.category === "string" ? body.category : "",
      description: typeof body.description === "string" ? body.description : "",
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao registrar denúncia" },
      { status: 400 }
    );
  }
}
