import { NextRequest, NextResponse } from "next/server";
import { checkJobsToken } from "@/lib/jobsAuth";
import { escalateChargebacksNearDeadline } from "@/services/chargebackEscalationService";

/**
 * POST /api/jobs/chargeback-escalation/run
 *
 * Agendador (D8=A2): ESCALONAMENTO de chargebacks próximos/vencidos do prazo
 * de envio de documentos da disputa (`deadlineToSendDisputeDocuments`).
 * Rota FINA — só traduz HTTP → service. Nenhuma regra de dinheiro aqui.
 *
 * Auth: cabeçalho `x-jobs-token` (JOBS_RUN_TOKEN). 401 sem token errado.
 * SOMENTE LEITURA: NÃO encerra chargeback (encerrar por prazo seria D6=A3,
 * rejeitado), NÃO altera `state`, NÃO cria lançamento, NÃO chama o provedor.
 * Idempotente por natureza: é somente leitura (nenhum efeito a duplicar).
 *
 * Log estruturado (sem PII): só contagens.
 */
export async function POST(req: NextRequest) {
  const denied = checkJobsToken(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  try {
    const result = await escalateChargebacksNearDeadline();
    console.log(
      `[Freelaz][escalonamento] chargebacks vencendo=${result.vencendo.length} ` +
        `vencidos=${result.vencidos.length}`
    );
    return NextResponse.json({
      ok: true,
      vencendo: result.vencendo.length,
      vencidos: result.vencidos.length,
      // Detalhamento sem PII (ids internos/status/prazo em dias) para o alerta.
      itens: result,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
