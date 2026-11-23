import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveDataUrlFile } from "@/lib/uploads";

/**
 * POST /api/verification/professional
 * Body: { documentUrl: dataUrl, selfieUrl: dataUrl }
 *
 * - CPF: documento com foto (RG/CNH) + selfie
 * - CNPJ: Cartão CNPJ (Comprovante de Inscrição) + selfie
 *
 * A verificação de CNPJ via Receita Federal está fora do MVP —
 * o Cartão CNPJ é evidência manual. Backlog P1.
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

  if (!body.documentUrl || !body.selfieUrl) {
    const docLabel =
      user.documentType === "CNPJ"
        ? "o Cartão CNPJ (Comprovante de Inscrição)"
        : "o documento com foto (RG ou CNH)";
    return NextResponse.json(
      { error: `Envie ${docLabel} e uma selfie para concluir a verificação` },
      { status: 422 }
    );
  }

  const [doc, selfie] = await Promise.all([
    saveDataUrlFile(body.documentUrl, `verifications/${user.id}`),
    saveDataUrlFile(body.selfieUrl, `verifications/${user.id}`),
  ]);
  if ("error" in doc)
    return NextResponse.json({ error: `Documento: ${doc.error}` }, { status: 422 });
  if ("error" in selfie)
    return NextResponse.json({ error: `Selfie: ${selfie.error}` }, { status: 422 });
  documentUrl = doc.url;
  selfieUrl = selfie.url;

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

  // Pré-triagem OCR (sessão 2) - flag off por padrão, nunca falha submissão
  if (process.env.DOCUMENT_AI_ENABLED === "true") {
    try {
      const { triageDocument } = await import("@/services/identityTriageService");
      await triageDocument(verification.id);
    } catch (err) {
      // Falha OCR não pode falhar submissão
      console.error("Falha na pré-triagem OCR:", err);
    }
  }

  return NextResponse.json({ verification }, { status: 201 });
}
