import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * POST /api/verification/contractor — verificação leve do papel Contratante.
 *
 * Não exige documento: basta o e-mail confirmado (o telefone entra quando
 * houver provedor SMS/WhatsApp, Fase 6 — aí os dois passam a ser exigidos).
 * A validação de identidade mais forte acontece no pagamento, via KYC do
 * próprio Mercado Pago — não aqui.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const assignment = user.roles.find((r) => r.role === "CONTRATANTE");
  if (!assignment) {
    return NextResponse.json(
      { error: "Ative o papel Contratante antes de verificar" },
      { status: 409 }
    );
  }
  if (!user.emailConfirmedAt) {
    return NextResponse.json(
      { error: "Confirme seu e-mail antes de verificar o papel Contratante" },
      { status: 422 }
    );
  }

  await prisma.$transaction([
    prisma.contractorProfile.update({
      where: { userId: user.id },
      data: { verificationStatus: "VERIFICADO" },
    }),
    prisma.identityVerification.upsert({
      where: { id: `${user.id}:CONTRATANTE` },
      create: {
        id: `${user.id}:CONTRATANTE`,
        userId: user.id,
        role: "CONTRATANTE",
        status: "VERIFICADO",
        analyzedAt: new Date(),
      },
      update: { status: "VERIFICADO", analyzedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ verificationStatus: "VERIFICADO" });
}
