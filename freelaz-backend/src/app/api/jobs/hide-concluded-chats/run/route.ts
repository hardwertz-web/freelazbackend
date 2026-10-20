import { NextRequest, NextResponse } from "next/server";
import { checkJobsToken } from "@/lib/jobsAuth";
import { hideConcludedChats } from "@/services/chatService";

/**
 * POST /api/jobs/hide-concluded-chats/run
 *
 * Agendador: aplica o SOFT-HIDE (estilo iFood) nos chats de contratações
 * CONCLUIDAS há mais de 2h — preenche `Chat.hiddenAt`, mas NÃO apaga nada
 * (`Message`/`Chat` ficam no banco e o ADMIN continua enxergando).
 *
 * Pula (conta em `skipped`) quando há disputa aberta/em análise ou chargeback
 * ATIVO correlacionado — o histórico precisa continuar visível.
 *
 * Auth: cabeçalho `x-jobs-token` (JOBS_RUN_TOKEN). Idempotente: rodar 2x não
 * reoculta nem reconta o que já está oculto. Rota FINA: só traduz HTTP →
 * service. Log estruturado SEM PII (só contagens).
 */
export async function POST(req: NextRequest) {
  const denied = checkJobsToken(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  try {
    const result = await hideConcludedChats();
    console.info(
      `[job] hide-concluded-chats: hidden=${result.hidden} skipped_dispute=${result.skipped.dispute} skipped_chargeback=${result.skipped.chargeback}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
