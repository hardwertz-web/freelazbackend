import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/internalAuth";
import { checkHoldingTimeouts } from "@/services/holdingTimeoutService";

/**
 * POST /api/cron/holding-timeout
 * Roda DIARIAMENTE. Detecta contratações RETIDAS há mais de 3 dias
 * sem revisão humana e abre disputa administrativa. NUNCA move dinheiro.
 *
 * Rota interna (header x-internal-secret).
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalSecret(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const result = await checkHoldingTimeouts();

  console.log(
    `[Freelaz][holding-timeout] checked=${result.checked} flagged=${result.flagged.length} skipped=${result.skipped.length}`
  );
  for (const f of result.flagged) {
    console.warn(
      `[Freelaz][holding-timeout] FLAGGED hiring=${f.hiringId} days=${f.daysSinceReference} reference=${f.reference}`
    );
  }

  return NextResponse.json(result);
}
