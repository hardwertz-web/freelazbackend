import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";

/**
 * POST /api/admin/verifications/[id]/reject
 * Rejeição humana de identidade com motivo OBRIGATÓRIo (auditado em
 * `rejectionReason` + `decidedById`). A rejeição NÃO bloqueia o usuário:
 * vira NAO_VERIFICADO e ele pode reenviar a verificação (a submissão ignora
 * registros NAO_VERIFICADO ao checar pendências).
 *
 * Body: { reason, adminId } — `adminId` exigido só no caminho do segredo
 * interno; pela sessão ADMIN do painel, o id auditado é o do usuário logado.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: o required abaixo causa 400 com mensagem clara
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: "reason é obrigatório (o usuário tem o direito de saber por quê)" },
      { status: 400 }
    );
  }
  const adminId =
    access.userId ?? (typeof body.adminId === "string" ? body.adminId.trim() : "");
  if (!adminId) {
    return NextResponse.json(
      { error: "adminId é obrigatório (auditoria de quem decidiu)" },
      { status: 400 }
    );
  }

  const verification = await prisma.identityVerification.findUnique({
    where: { id: params.id }
  });
  if (!verification) {
    return NextResponse.json({ error: "Verificação não encontrada" }, { status: 404 });
  }
  if (verification.status !== "EM_ANALISE") {
    return NextResponse.json(
      { error: `Verificação não está em análise (status atual: ${verification.status})` },
      { status: 409 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.identityVerification.update({
        where: { id: verification.id },
        data: {
          status: "NAO_VERIFICADO",
          rejectionReason: reason,
          analyzedAt: new Date(),
          decidedById: adminId
        }
      });
      if (verification.role === "PROFISSIONAL") {
        await tx.professionalProfile.update({
          where: { userId: verification.userId },
          data: { verificationStatus: "NAO_VERIFICADO" }
        });
      } else if (verification.role === "CONTRATANTE") {
        await tx.contractorProfile.update({
          where: { userId: verification.userId },
          data: { verificationStatus: "NAO_VERIFICADO" }
        });
      }
      // O papel continua PENDENTE de propósito: o usuário pode reenviar a
      // verificação depois de corrigir o problema apontado.
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao rejeitar verificação" },
      { status: 409 }
    );
  }

  await logAdminAction({
    adminAccess: { userId: access.userId, via: access.via },
    action: "VERIFICATION_REJECTED",
    targetType: "IdentityVerification",
    targetId: verification.id,
    metadata: {
      userId: verification.userId,
      role: verification.role,
      reason,
      adminId,
    },
    request: req,
  });

  return NextResponse.json({ rejected: true, decidedById: adminId });
}
