import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/internalAuth";
import { processPendingPayouts } from "@/services/payoutService";

/**
 * POST /api/cron/payouts
 * Repasse SEMANAL em lote: libera todas as contratações CONCLUIDAS que ainda
 * não foram repassadas. Uma falha numa contratação não impede as outras; o que
 * falhar fica com Payout FALHOU e é retentado na próxima execução.
 *
 * Rota interna (header x-internal-secret) — dinheiro nunca se move por ação
 * manual livre (Governança Financeira).
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalSecret(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const result = await processPendingPayouts();

  console.log(
    `[Freelaz][repasse-semanal] elegiveis=${result.eligible} repassadas=${result.released.length} falhas=${result.failed.length}`
  );

  return NextResponse.json(result);
}
