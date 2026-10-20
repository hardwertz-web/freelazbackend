import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * GET /api/admin/ledger?hiringId=...&take=100
 * Livro-razão auditado para o painel: TODO lançamento (RETENCAO, LIBERACAO,
 * REEMBOLSO, AJUSTE) com quem o criou. O ledger é append-only — este endpoint
 * é leitura pura; correção manual é um AJUSTE novo, nunca edição de histórico.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const hiringId = searchParams.get("hiringId");
  const takeParam = Number(searchParams.get("take") ?? "100");
  const take = Math.min(Math.max(Number.isFinite(takeParam) ? takeParam : 100, 1), 500);

  const entries = await prisma.ledgerEntry.findMany({
    where: hiringId ? { hiringId } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: { hiring: { select: { id: true, jobTitle: true, status: true } } }
  });

  return NextResponse.json({ entries });
}
