import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";

/**
 * POST /api/proposals/:id/cancel — cancela uma proposta privada ENVIADA.
 *
 * Necessário porque o `REJECT` de `/api/applications/:id/respond`, quando
 * chamado pelo contratante, apenas retira a contraproposta e devolve a
 * candidatura para PENDENTE — ele não encerra o convite. Como a Fase 2.5 não
 * pode alterar as rotas existentes, o cancelamento ganha esta rota dedicada.
 *
 * Regras:
 * - só o contratante dono da vaga privada;
 * - só enquanto a proposta está PENDENTE (ainda sem contraproposta/resposta);
 * - a candidatura vira DESISTIU e a vaga privada vira CANCELADA na mesma
 *   transação (não sobra convite aberto no banco).
 *
 * Retorna 404 para id inexistente/de outro contratante (não vaza existência).
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json(auth.error.body, { status: auth.error.status });
  }
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json(
      { error: "Papel Contratante necessário" },
      { status: 403 }
    );
  }

  const application = await prisma.application.findUnique({
    where: { id: params.id },
    include: {
      jobPosting: {
        select: { id: true, contractorId: true, visibility: true, status: true },
      },
    },
  });

  if (
    !application ||
    application.jobPosting.contractorId !== auth.user.id ||
    application.jobPosting.visibility !== "PRIVADA"
  ) {
    return NextResponse.json(
      { error: "Proposta não encontrada" },
      { status: 404 }
    );
  }

  if (application.status !== "PENDENTE") {
    return NextResponse.json(
      {
        error:
          "Só é possível cancelar uma proposta que ainda aguarda resposta do profissional",
      },
      { status: 409 }
    );
  }

  const [updatedApplication] = await prisma.$transaction([
    prisma.application.update({
      where: { id: application.id },
      data: { status: "DESISTIU" },
      select: { id: true, status: true },
    }),
    prisma.jobPosting.update({
      where: { id: application.jobPosting.id },
      data: { status: "CANCELADA" },
      select: { id: true, status: true },
    }),
  ]);

  return NextResponse.json({
    application: updatedApplication,
    jobPosting: { id: application.jobPosting.id, status: "CANCELADA" },
  });
}
