import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveDataUrlFile } from "@/lib/uploads";

/**
 * POST /api/verification/professional
 * Body: { documentUrl: dataUrl, selfieUrl: dataUrl }   (contas CPF)
 *       {}                                             (contas CNPJ)
 *
 * Envia a verificação do papel Profissional:
 * - CPF: documento com foto (RG/CNH) + selfie — obrigatórios os dois
 * - CNPJ: sem documento/selfie; a validação do CNPJ (feita já no cadastro)
 *   basta para a submissão — aprovação final é humana (EM_ANALISE)
 *
 * Aprovação muda o status para VERIFICADO e ativa o papel (vira ATIVO).
 * Enquanto não houver painel admin (Fase 5), a aprovação é feita no
 * Prisma Studio: IdentityVerification.status = VERIFICADO e
 * UserRoleAssignment.status = ATIVO (mesmo userId).
 *
 * Sem antecedentes criminais — decisão deliberada de inclusão (CLAUDE.md).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const assignment = user.roles.find((r) => r.role === "PROFISSIONAL");
  if (!assignment) {
    return NextResponse.json(
      { error: "Ative o papel Profissional antes de enviar a verificação" },
      { status: 409 }
    );
  }
  if (assignment.status === "ATIVO") {
    return NextResponse.json({ error: "Papel Profissional já verificado" }, { status: 409 });
  }

  let body: { documentUrl?: string; selfieUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  let documentUrl: string | null = null;
  let selfieUrl: string | null = null;

  if (user.documentType === "CPF") {
    if (!body.documentUrl || !body.selfieUrl) {
      return NextResponse.json(
        { error: "Envie o documento com foto (RG/CNH) e a selfie" },
        { status: 422 }
      );
    }
    const [doc, selfie] = await Promise.all([
      saveDataUrlFile(body.documentUrl, `verifications/${user.id}`),
      saveDataUrlFile(body.selfieUrl, `verifications/${user.id}`),
    ]);
    if ("error" in doc) return NextResponse.json({ error: `Documento: ${doc.error}` }, { status: 422 });
    if ("error" in selfie) return NextResponse.json({ error: `Selfie: ${selfie.error}` }, { status: 422 });
    documentUrl = doc.url;
    selfieUrl = selfie.url;
  }
  // CNPJ: o documento já foi validado no cadastro — nada a anexar aqui.

  const existing = await prisma.identityVerification.findFirst({
    where: { userId: user.id, role: "PROFISSIONAL", status: { not: "NAO_VERIFICADO" } },
  });
  if (existing && existing.status === "EM_ANALISE") {
    return NextResponse.json(
      { error: "Há uma verificação em análise — aguarde a resposta" },
      { status: 409 }
    );
  }

  const verification = await prisma.$transaction(async (tx) => {
    const v = await tx.identityVerification.create({
      data: { userId: user.id, role: "PROFISSIONAL", documentUrl, selfieUrl },
    });
    await tx.professionalProfile.update({
      where: { userId: user.id },
      data: { verificationStatus: "EM_ANALISE" },
    });
    return v;
  });

  return NextResponse.json({ verification }, { status: 201 });
}
