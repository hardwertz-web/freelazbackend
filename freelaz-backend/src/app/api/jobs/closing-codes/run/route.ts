import { NextRequest, NextResponse } from "next/server";
import { checkJobsToken } from "@/lib/jobsAuth";
import { generateClosingCodesDue } from "@/services/codeService";

/**
 * POST /api/jobs/closing-codes/run
 *
 * Agendador: gera o código de FECHAMENTO dos turnos que terminam em ~1h.
 * Rota FINA — só traduz HTTP → service (`generateClosingCodesDue`).
 *
 * Auth: cabeçalho `x-jobs-token` (JOBS_RUN_TOKEN). 401 sem token errado.
 * Idempotente por estado: rodar 2x não regrava código já gerado (2ª vez → 0).
 * Não chama o provedor de pagamento.
 */
export async function POST(req: NextRequest) {
  const denied = checkJobsToken(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  try {
    const processed = await generateClosingCodesDue();
    return NextResponse.json({ ok: true, processed });
  } catch (err) {
    const error = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
