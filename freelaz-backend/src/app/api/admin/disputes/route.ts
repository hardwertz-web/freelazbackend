import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { maskDocument } from "@/lib/publicUser";

/**
 * GET /api/admin/disputes?status=EM_ANALISE
 * Fila administrativa de disputas — aceita o segredo interno (infra/testes)
 * ou sessão de conta com papel ADMIN (painel). Cada DECISÃO grava o
 * `adminId` auditado (id da sessão no caminho do painel).
 *
 * Enriquecida para análise: quem abriu (lado), partes da contratação com
 * documento mascarado (nunca completo — LGPD) e a autoria de cada evidência.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") ?? "EM_ANALISE").toUpperCase();

  const disputes = await prisma.dispute.findMany({
    where: { status: status as never },
    orderBy: { createdAt: "asc" },
    include: {
      evidences: true,
      hiring: {
        select: {
          id: true,
          jobTitle: true,
          status: true,
          grossValueCents: true,
          netValueCents: true,
          closingCodeUsedAt: true,
          contractor: {
            select: { id: true, name: true, documentType: true, document: true }
          },
          professional: {
            select: { id: true, name: true, documentType: true, document: true }
          },
        },
      },
    },
  });

  // Autoria das evidências (uploadedById é coluna simples, sem relação).
  const uploaderIds = [...new Set(disputes.flatMap((d) => d.evidences.map((e) => e.uploadedById)))];
  const uploaders = await prisma.user.findMany({
    where: { id: { in: uploaderIds } },
    select: { id: true, name: true },
  });
  const uploaderName = new Map(uploaders.map((u) => [u.id, u.name]));

  const shaped = disputes.map((d) => ({
    ...d,
    hiring: {
      ...d.hiring,
      contractor: {
        id: d.hiring.contractor.id,
        name: d.hiring.contractor.name,
        documentType: d.hiring.contractor.documentType,
        documentMasked: maskDocument(d.hiring.contractor.document),
      },
      professional: {
        id: d.hiring.professional.id,
        name: d.hiring.professional.name,
        documentType: d.hiring.professional.documentType,
        documentMasked: maskDocument(d.hiring.professional.document),
      },
    },
    evidences: d.evidences.map((e) => ({
      ...e,
      uploadedByName: uploaderName.get(e.uploadedById) ?? null,
    })),
  }));

  return NextResponse.json({ disputes: shaped });
}
