import { NextRequest, NextResponse } from "next/server";
import { checkJobsToken } from "@/lib/jobsAuth";
import { runReconciliation } from "@/services/reconciliationService";

/**
 * POST /api/jobs/daily-reconciliation/run
 *
 * Agendador: reconciliação DIÁRIA (`runReconciliation`).
 * Rota FINA — só traduz HTTP → service. Não corrige nada: reporta divergências.
 *
 * Auth: cabeçalho `x-jobs-token` (JOBS_RUN_TOKEN). 401 sem token errado.
 * Idempotente por natureza: é somente leitura (nenhum efeito a duplicar).
 */
export async function POST(req: NextRequest) {
  const denied = checkJobsToken(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  try {
    const report = await runReconciliation();
    // `processed` = invariantes conferidas (checks). O relatório inteiro segue
    // no corpo para que o agendador/monitoramento recolha as divergências.
    return NextResponse.json({
      ok: true,
      processed: report.checks.length,
      report,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
