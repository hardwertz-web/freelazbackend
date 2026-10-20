import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { publicUser } from "@/lib/publicUser";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/auth/me — estado da sessão atual: usuário, papéis (com status
 * PENDENTE/ATIVO) e perfis mínimos. É por aqui que o front decide o
 * onboarding (ex: ativar verificação do papel Profissional).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const [professionalProfile, contractorProfile] = await Promise.all([
    prisma.professionalProfile.findUnique({
      where: { userId: user.id },
      select: { bio: true, categories: true, verificationStatus: true, headline: true },
    }),
    prisma.contractorProfile.findUnique({
      where: { userId: user.id },
      select: { verificationStatus: true },
    }),
  ]);

  return NextResponse.json({
    user: publicUser(user),
    roles: user.roles,
    professionalProfile,
    contractorProfile,
  });
}
