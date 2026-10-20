import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * GET /api/admin/payouts?status=FALHOU&take=50
 * Repasses (transferências Pix de saída) para o painel: status, valor,
 * id no provedor e motivo de falha — a fila de retentativa é do lote
 * automático (`/api/cron/payouts`), aqui é só consulta.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const takeParam = Number(searchParams.get("take") ?? "50");
  const take = Math.min(Math.max(Number.isFinite(takeParam) ? takeParam : 50, 1), 100);

  const payouts = await prisma.payout.findMany({
    where: status ? { status: status.toUpperCase() as never } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      professional: { select: { id: true, name: true } },
      hiring: { select: { id: true, jobTitle: true, status: true } }
    }
  });

  return NextResponse.json({ payouts });
}
