import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { publicUser } from "@/lib/publicUser";

/**
 * GET /api/profile/contractor — dados da conta no papel Contratante.
 * PUT — atualização básica (cidade/estado, nome fantasia do CNPJ, telefone).
 *
 * O papel Contratante não tem portfólio/bio: o "perfil" é a própria conta
 * + status da verificação leve e a assinatura do plano CLT (Fase 5).
 */
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const hasRole = user.roles.some((r) => r.role === "CONTRATANTE");
  if (!hasRole) {
    return NextResponse.json(
      { error: "Papel Contratante não ativado nesta conta" },
      { status: 409 }
    );
  }

  const profile = await prisma.contractorProfile.findUnique({
    where: { userId: user.id },
    include: { cltPlan: true },
  });

  return NextResponse.json({ user: publicUser(user), profile });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const hasRole = user.roles.some((r) => r.role === "CONTRATANTE");
  if (!hasRole) {
    return NextResponse.json(
      { error: "Ative o papel Contratante antes de editar" },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const data: {
    city?: string | null;
    state?: string | null;
    tradeName?: string | null;
    phone?: string;
  } = {};
  if (body.city !== undefined) data.city = String(body.city ?? "").trim().slice(0, 80) || null;
  if (body.state !== undefined) data.state = String(body.state ?? "").trim().toUpperCase().slice(0, 2) || null;
  if (body.tradeName !== undefined && user.documentType === "CNPJ") {
    data.tradeName = String(body.tradeName ?? "").trim().slice(0, 120) || null;
  }
  if (body.phone !== undefined) {
    const digits = String(body.phone).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) {
      return NextResponse.json({ error: "Telefone inválido (DDD + número)" }, { status: 422 });
    }
    data.phone = digits;
  }

  try {
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    return NextResponse.json({ user: publicUser(updated) });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Telefone já em uso em outra conta" }, { status: 409 });
    }
    throw err;
  }
}
