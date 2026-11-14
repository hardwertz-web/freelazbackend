import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * GET /api/admin/metrics?from=ISO&to=ISO
 * KPIs agregados do período (default: últimos 30 dias).
 *
 * - gmvCents: sum(grossValueCents) de hirings EFETIVADOS (≠ CANCELADO e
 *   ≠ AGUARDANDO_PAGAMENTO). Cobrança emitida e não paga não é volume.
 * - hiringCount: número de hirings efetivados
 * - pendingPaymentCount: hirings AGUARDANDO_PAGAMENTO no período (separado,
 *   para o painel mostrar o que está "no forno" sem inflar o GMV)
 * - cancelledCount: hirings CANCELADO
 * - commissionRevenueCents: comissão LEGACY (gross - net) dos efetivados
 * - platformFeeRevenueCents: sum(RECEITA_PLATAFORMA) do ledger
 * - revenueCents: commissionRevenueCents + platformFeeRevenueCents
 * - ticketMedioCents: gmvCents / hiringCount
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : defaultFrom;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "from/to inválidos" }, { status: 400 });
  }

  const range = { gte: from, lte: to };
  // "Efetivado" = saiu de AGUARDANDO_PAGAMENTO e não foi cancelado.
  const effectiveStatus = { notIn: ["CANCELADO", "AGUARDANDO_PAGAMENTO"] };

  const [
    activeAgg,
    activeCount,
    pendingPaymentCount,
    cancelledCount,
    platformFeeAgg,
    jobPostingCount,
  ] = await Promise.all([
    prisma.hiring.aggregate({
      where: { createdAt: range, status: effectiveStatus },
      _sum: { grossValueCents: true, netValueCents: true },
    }),
    prisma.hiring.count({
      where: { createdAt: range, status: effectiveStatus },
    }),
    prisma.hiring.count({
      where: { createdAt: range, status: "AGUARDANDO_PAGAMENTO" },
    }),
    prisma.hiring.count({
      where: { createdAt: range, status: "CANCELADO" },
    }),
    prisma.ledgerEntry.aggregate({
      where: { type: "RECEITA_PLATAFORMA", createdAt: range },
      _sum: { amountCents: true },
    }),
    prisma.jobPosting.count({
      where: { createdAt: range, status: { in: ["ABERTA", "PREENCHIDA"] } },
    }),
  ]);

  const gmvCents = activeAgg._sum.grossValueCents ?? 0;
  const totalNet = activeAgg._sum.netValueCents ?? 0;
  const commissionRevenueCents = Math.max(0, gmvCents - totalNet);
  const platformFeeRevenueCents = platformFeeAgg._sum.amountCents ?? 0;
  const revenueCents = commissionRevenueCents + platformFeeRevenueCents;
  const ticketMedioCents = activeCount > 0 ? Math.round(gmvCents / activeCount) : 0;

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    gmvCents,
    hiringCount: activeCount,
    pendingPaymentCount,
    cancelledCount,
    commissionRevenueCents,
    platformFeeRevenueCents,
    revenueCents,
    ticketMedioCents,
    jobPostingCount,
  });
}
