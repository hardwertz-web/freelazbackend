import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/internalAuth";
import { runReconciliation } from "@/services/reconciliationService";

/**
 * POST /api/cron/reconciliation
 * Reconciliação DIÁRIA: confere as invariantes do dinheiro (ledger x Payout x
 * status) e reporta as divergências. Não corrige nada sozinho — divergência é
 * para um humano olhar (o ajuste manual é AJUSTE no ledger, com revisão).
 *
 * Rota interna (header x-internal-secret). O resumo também vai para o log do
 * servidor, que é o que o agendador/monitoramento recolhe.
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalSecret(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const report = await runReconciliation();

  console.log(
    `[Freelaz][reconciliacao] ok=${report.ok} divergencias=${report.discrepancies.length} retido=${report.totals.retainedCents}`
  );
  for (const discrepancy of report.discrepancies) {
    console.warn(`[Freelaz][reconciliacao] DIVERGENCIA: ${discrepancy}`);
  }

  return NextResponse.json(report);
}
