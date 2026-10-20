import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { parseJobFields } from "@/lib/jobInput";

/**
 * POST /api/jobs/invite
 * Botão "Me contrate" no perfil do profissional. Gera uma vaga PRIVADA
 * (visível só para aquele profissional, nunca aparece no marketplace) com
 * uma candidatura automática em status PENDENTE, para ele aceitar, recusar
 * ou enviar contraproposta — ver CLAUDE.md > "Fluxo da contratação", passo 1.
 *
 * O contratante é SEMPRE o usuário da sessão (nunca um id vindo do corpo —
 * senão qualquer um criaria convites em nome de outra empresa).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  if (!hasActiveRole(user, "CONTRATANTE")) {
    return NextResponse.json(
      { error: "Ative o papel Contratante para convidar um profissional" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const targetProfessionalId =
    typeof body.targetProfessionalId === "string" ? body.targetProfessionalId.trim() : "";
  if (!targetProfessionalId) {
    return NextResponse.json({ error: "targetProfessionalId é obrigatório" }, { status: 400 });
  }

  // Mesmas regras de título/descrição/categoria/valor/horário da vaga pública.
  const parsed = parseJobFields(body, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const target = await prisma.user.findUnique({
    where: { id: targetProfessionalId },
    include: { roles: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Profissional não encontrado" }, { status: 404 });
  }
  if (!target.roles.some((r) => r.role === "PROFISSIONAL" && r.status === "ATIVO")) {
    return NextResponse.json(
      { error: "Este usuário não tem o papel Profissional ativo" },
      { status: 422 }
    );
  }

  const jobPosting = await prisma.jobPosting.create({
    data: {
      contractorId: user.id,
      targetProfessionalId,
      visibility: "PRIVADA",
      ...parsed.data,
      applications: {
        create: { professionalId: targetProfessionalId, status: "PENDENTE" },
      },
    },
    include: { applications: true },
  });

  // TODO: notificar o profissional (push/WhatsApp) sobre a proposta recebida

  return NextResponse.json({ jobPosting }, { status: 201 });
}
