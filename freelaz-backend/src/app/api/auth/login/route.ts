import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { publicUser } from "@/lib/publicUser";

/**
 * POST /api/auth/login — e-mail + senha.
 * Mensagem única de erro para e-mail inexistente ou senha errada (não
 * revelar qual dos dois falhou).
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Informe e-mail e senha" }, { status: 422 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: true },
  });
  // Usa hashPassword mesmo sem usuário pra manter o tempo de resposta
  // constante (evita descobrir e-mails cadastrados por timing).
  const stored = user?.passwordHash ?? "scrypt$00$00";
  const ok = await verifyPassword(password, stored);
  if (!user || !ok) {
    return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ user: publicUser(user), roles: user.roles });
}
