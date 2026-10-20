import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOneTimeToken } from "@/lib/auth";

/**
 * POST /api/auth/password/forgot — pede link/token de redefinição.
 * Sempre responde 200, exista o e-mail ou não (não vazia a lista de
 * cadastrados). Em dev o token sai no console do servidor; em produção,
 * entra na fila de e-mail quando houver provedor configurado (Fase 6).
 */
export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await createOneTimeToken(user.id, "PASSWORD_RESET");
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Freelaz] Token de redefinição de senha para ${email}: ${token}`);
      }
    }
  }

  return NextResponse.json({
    message: "Se esse e-mail estiver cadastrado, você receberá um código de redefinição",
  });
}
