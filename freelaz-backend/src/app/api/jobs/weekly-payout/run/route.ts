import { NextRequest, NextResponse } from "next/server";
import { checkJobsToken } from "@/lib/jobsAuth";
import { processPendingPayouts } from "@/services/payoutService";

/**
 * POST /api/jobs/weekly-payout/run
 *
 * Agendador: repasse SEMANAL em lote (`processPendingPayouts`).
 * Rota FINA — só traduz HTTP → service. Nenhuma regra de dinheiro aqui.
 *
 * Auth: cabeçalho `x-jobs-token` (JOBS_RUN_TOKEN). 401 sem token errado.
 * Idempotente por estado: só pega CONCLUIDO sem Payout (ou FALHOU);
 * `releasePayout` devolve o Payout existente se já CONCLUIDO.
 *
 * ⚠️ Esta rota MOVE dinheiro (Pix de repasse). Em dev/teste só roda contra
 * `PAYOUT_SANDBOX=1` ou mock — nunca contra o provedor real sem decisão humana.
 */
export async function POST(req: NextRequest) {
  const denied = checkJobsToken(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  try {
    const result = await processPendingPayouts();
    // `processed` = quantas contratações foram efetivamente repassadas. O
    // detalhamento fica no corpo para conciliação/monitoramento.
    return NextResponse.json({
      ok: true,
      processed: result.released.length,
      eligible: result.eligible,
      released: result.released,
      failed: result.failed,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
