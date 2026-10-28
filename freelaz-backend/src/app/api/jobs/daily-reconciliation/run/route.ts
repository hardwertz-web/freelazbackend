import { NextRequest, NextResponse } from "next/server";
import { checkJobsToken } from "@/lib/jobsAuth";
import { runReconciliation } from "@/services/reconciliationService";
import { releaseExpiredEvaluations } from "@/services/evaluationService";
import { chargebacksBlockingPayout } from "@/services/asaasEventService";
import { expireStaleProposals } from "@/services/proposalService";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/jobs/daily-reconciliation/run
 *
 * Agendador: reconciliação DIÁRIA (`runReconciliation`).
 * Rota FINA — só traduz HTTP → service. Não corrige nada: reporta divergências.
 *
 * Auth: cabeçalho `x-jobs-token` (JOBS_RUN_TOKEN). 401 sem token errado.
 *
 * Idempotente: `runReconciliation` é somente leitura,
 * `releaseExpiredEvaluations` só libera avaliações cegas com `releasedAt = null`
 * cujo prazo de 30d venceu e `expireStaleProposals` só toca propostas privadas
 * ainda vivas com mais de 7 dias (rodar duas vezes não muda nada).
 *
 * VISIBILIDADE (Etapa 3.3): ao final, emite UMA linha de log estruturada, sem
 * PII, com quantos chargebacks estão bloqueando repasse e há quantos dias está
 * o mais antigo. É só observabilidade — NÃO altera `ok`/`discrepancies` nem
 * qualquer estado.
 */
export async function POST(req: NextRequest) {
  const denied = checkJobsToken(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  try {
    const report = await runReconciliation();

    // Libera avaliações cegas cujo prazo de 30d venceu. Idempotente.
    const expired = await releaseExpiredEvaluations();

    // Expira propostas privadas ("Me contrate") paradas há mais de 7 dias.
    // Reusa DESISTIU (não existe ApplicationStatus.EXPIRADA). Idempotente.
    const expiredProposals = await expireStaleProposals();

    // ---- log estruturado de visibilidade (sem PII) -----------------------
    const blocked = await chargebacksBlockingPayout(prisma);
    const oldest = blocked.reduce<{ blockedSince: Date } | null>(
      (acc, b) => (acc === null || b.blockedSince < acc.blockedSince ? b : acc),
      null
    );
    const days = oldest
      ? Math.floor((Date.now() - oldest.blockedSince.getTime()) / (24 * 60 * 60 * 1000))
      : 0;
    console.log(
      `[Freelaz][reconciliacao] chargebacks bloqueando repasse=${blocked.length} ` +
        `mais antigo há ${days} dia(s)`
    );

    // `processed` = invariantes conferidas (checks). O relatório inteiro segue
    // no corpo para que o agendador/monitoramento recolha as divergências.
    return NextResponse.json({
      ok: true,
      processed: report.checks.length,
      // Campo aditivo (Fase 2.3b): quantas avaliações cegas venceram hoje.
      evaluationsReleased: expired.released,
      // Campo aditivo (Fase 2.5): propostas privadas >7d viraram DESISTIU.
      proposalsExpired: expiredProposals.expired,
      report,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
