import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * GET /api/auth/roles — papéis da conta atual com status.
 * POST /api/auth/roles — { role: "PROFISSIONAL" | "CONTRATANTE" }
 *   Ativa um papel que ainda não existe na conta (configurações da conta
 *   podem fazer isso a qualquer momento — CLAUDE.md > "Cadastro e papéis").
 *   - Contratante: ativa direto (verificação leve é o selo, não o acesso)
 *   - Profissional: entra como PENDENTE e só vira ATIVO quando a
 *     verificação de identidade for aprovada (ver /api/verification)
 */
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  return NextResponse.json({ roles: auth.user.roles });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.role !== "PROFISSIONAL" && body.role !== "CONTRATANTE") {
    return NextResponse.json(
      { error: "role deve ser PROFISSIONAL ou CONTRATANTE" },
      { status: 400 }
    );
  }
  const role = body.role;

  const existing = user.roles.find((r) => r.role === role);
  if (existing) {
    return NextResponse.json(
      { error: "Este papel já está ativo na sua conta", role: existing },
      { status: 409 }
    );
  }

  const status = role === "PROFISSIONAL" ? "PENDENTE" : "ATIVO";
  const assignment = await prisma.userRoleAssignment.upsert({
    where: { userId_role: { userId: user.id, role } },
    create: { userId: user.id, role, status },
    update: { status },
  });

  // Garante o perfil correspondente (upsert: pode ter sido desativado antes)
  if (role === "PROFISSIONAL") {
    await prisma.professionalProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
  } else {
    await prisma.contractorProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
  }

  return NextResponse.json({ role: assignment }, { status: 201 });
}
