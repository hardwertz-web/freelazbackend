import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { chargebacksBlockingPayout, type BlockedChargeback } from "@/services/asaasEventService";

/**
 * GET /api/admin/chargebacks/blocked
 *
 * Visibilidade READ-ONLY dos chargebacks externos ATIVOS que estão BLOQUEANDO
 * repasse (o "D6 pendente" — enquanto D1–D8 não for decidido, um chargeback
 * ativo bloqueia a liberação; ver `payoutService.payoutBlockReason`).
 *
 * Responde:
 *   {
 *     total: N,                       // quantas contratações estão bloqueadas hoje
 *     porStatus: { REQUESTED: 2, ... },// distribuição do status EXTERNO (cru)
 *     maisAntigo: { hiringId, bloqueadoDesde } | null
 *   }
 *
 * Regras:
 *  - SOMENTE LEITURA. NÃO desbloqueia nada, NÃO altera `payoutBlockReason`,
 *    NÃO move dinheiro, NÃO muda `state` dos chargebacks.
 *  - "Bloqueando repasse" vem do helper compartilhado
 *    `chargebacksBlockingPayout` (mesmo critério de `payoutBlockReason`).
 *  - Guarda igual à dos demais endpoints admin (`checkAdminAccess`).
 *  - Nunca devolve payload bruto nem dados do portador — só ids/status/datas.
 *
 * NOTA: `porStatus` conta REGISTROS ativos (distribuição do status externo,
 * que pode ter mais de um por contratação no histórico); `total` conta
 * CONTRATAÇÕES distintas bloqueadas.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const blocked = await chargebacksBlockingPayout(prisma);

  const porStatus: Record<string, number> = {};
  for (const b of blocked) {
    porStatus[b.externalStatus] = (porStatus[b.externalStatus] ?? 0) + 1;
  }

  const oldest = blocked.reduce<BlockedChargeback | null>(
    (acc, b) => (acc === null || b.blockedSince < acc.blockedSince ? b : acc),
    null
  );

  return NextResponse.json({
    total: blocked.length,
    porStatus,
    maisAntigo: oldest
      ? { hiringId: oldest.hiringId, bloqueadoDesde: oldest.blockedSince.toISOString() }
      : null,
  });
}
