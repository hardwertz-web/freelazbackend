import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * POST /api/admin/verifications/[id]/approve
 * Aprovação humana de identidade — exatamente o que era feito à mão no
 * Prisma Studio, agora em UMA transação (nada de estado meio-aprovado):
 *   1. IdentityVerification → VERIFICADO + decidedById + analyzedAt;
 *   2. UserRoleAssignment (userId + papel) → ATIVO (é a trava de
 *      busca/candidatura/publicação);
 *   3. verificationStatus do perfil correspondente → VERIFICADO.
 *
 * Body: { adminId } — exigido só no caminho do segredo interno; pela sessão
 * ADMIN do painel, o id auditado é o do usuário logado.
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
    // corpo vazio segue válido — o required abaixo cuida do 400
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
        data: { status: "VERIFICADO", analyzedAt: new Date(), decidedById: adminId }
      });
      const assignment = await tx.userRoleAssignment.update({
        where: { userId_role: { userId: verification.userId, role: verification.role } },
        data: { status: "ATIVO", activeAt: new Date() }
      });
      if (assignment.status !== "ATIVO") {
        // defensivo: a escrita acima garante ATIVO, nunca devia falhar aqui
        throw new Error("papel não ativou");
      }
      if (verification.role === "PROFISSIONAL") {
        await tx.professionalProfile.update({
          where: { userId: verification.userId },
          data: { verificationStatus: "VERIFICADO" }
        });
      } else if (verification.role === "CONTRATANTE") {
        await tx.contractorProfile.update({
          where: { userId: verification.userId },
          data: { verificationStatus: "VERIFICADO" }
        });
      }
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao aprovar verificação" },
      { status: 409 }
    );
  }

  return NextResponse.json({ approved: true, decidedById: adminId });
}
