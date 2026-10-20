import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeOneTimeToken, getCurrentUser } from "@/lib/auth";

/**
 * POST /api/auth/confirm — { token } confirma o e-mail da conta atual.
 *
 * A confirmação de e-mail é parte da "verificação leve" do papel
 * Contratante (confirmação de telefone entra junto com o provedor de
 * SMS/WhatsApp na Fase 6 — o selo de contratante verificado só sai com
 * os dois confirmados).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const token = String(body.token ?? "");
  if (!token) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 422 });
  }

  const userId = await consumeOneTimeToken(token, "EMAIL_CONFIRM");
  if (!userId || userId !== user.id) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 422 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { emailConfirmedAt: new Date() },
  });

  return NextResponse.json({ emailConfirmedAt: updated.emailConfirmedAt });
}
