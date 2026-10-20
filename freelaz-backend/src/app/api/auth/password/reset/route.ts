import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeOneTimeToken, hashPassword } from "@/lib/auth";

/**
 * POST /api/auth/password/reset — { token, newPassword }.
 * O token é de uso único (marcado como usado no banco) e expira em 30 min.
 * Ao trocar a senha, as sessões antigas são destruídas por segurança.
 */
export async function POST(req: NextRequest) {
  let body: { token?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const token = String(body.token ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!token) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 422 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "A senha precisa de pelo menos 8 caracteres" }, { status: 422 });
  }

  const userId = await consumeOneTimeToken(token, "PASSWORD_RESET");
  if (!userId) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 422 });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);

  return NextResponse.json({ message: "Senha redefinida com sucesso" });
}
