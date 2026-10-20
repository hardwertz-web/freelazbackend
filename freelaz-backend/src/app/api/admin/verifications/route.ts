import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { maskDocument } from "@/lib/publicUser";

/**
 * GET /api/admin/verifications?status=EM_ANALISE
 * Fila de verificação de identidade para o painel. O documento COMPLETO não
 * sai da API (LGPD): o operador vê a forma mascarada, e os arquivos
 * (documento/selfie) são abertos pelo caminho de uploads autenticado, que
 * libera para papel ADMIN. Fila default: EM_ANALISE (as pendentes).
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") ?? "EM_ANALISE").toUpperCase();

  const verifications = await prisma.identityVerification.findMany({
    where: { status: status as never },
    orderBy: { submittedAt: "asc" },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          tradeName: true,
          documentType: true,
          document: true
        }
      }
    }
  });

  const shaped = verifications.map((v) => ({
    id: v.id,
    role: v.role,
    status: v.status,
    documentUrl: v.documentUrl,
    selfieUrl: v.selfieUrl,
    rejectionReason: v.rejectionReason,
    decidedById: v.decidedById,
    submittedAt: v.submittedAt,
    analyzedAt: v.analyzedAt,
    user: {
      id: v.user.id,
      name: v.user.name,
      tradeName: v.user.tradeName,
      documentType: v.user.documentType,
      documentMasked: maskDocument(v.user.document)
    }
  }));

  return NextResponse.json({ verifications: shaped });
}
