import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { maskDocument } from "@/lib/publicUser";

/**
 * GET /api/admin/hirings?status=RETIDO&take=50
 * Visão global de contratações para o painel: partes (documento mascarado),
 * valores, payout e lançamentos do ledger. É CONSULTA — nenhuma escrita
 * acontece aqui; transições de estado e dinheiro seguem exclusivamente pelos
 * caminhos de sempre (hiringService/disputeService/ledger).
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

  const hirings = await prisma.hiring.findMany({
    where: status ? { status: status.toUpperCase() } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      contractor: {
        select: {
          id: true,
          name: true,
          documentType: true,
          document: true
        }
      },
      professional: {
        select: {
          id: true,
          name: true,
          documentType: true,
          document: true
        }
      },
      payout: true,
      ledgerEntries: { orderBy: { createdAt: "asc" } },
      disputes: { select: { id: true, status: true, resolution: true } }
    }
  });

  // Documento completo nunca sai daqui — só a forma mascarada (LGPD).
  const shaped = hirings.map((h) => ({
    ...h,
    contractor: { ...h.contractor, documentMasked: maskDocument(h.contractor.document), document: undefined },
    professional: { ...h.professional, documentMasked: maskDocument(h.professional.document), document: undefined }
  }));

  return NextResponse.json({ hirings: shaped });
}
