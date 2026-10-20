import { NextRequest, NextResponse } from "next/server";
import { ApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * GET /api/applications — "minhas candidaturas" (lado Profissional).
 * Devolve cada candidatura com o essencial da vaga e o status resultante
 * (PENDENTE, CONTRAPROPOSTA, SELECIONADO, SUPLENTE, DESISTIU) para o
 * profissional acompanhar o que responderam.
 *
 * Exige ter o papel Profissional na conta (ATIVO ou PENDENTE): um PENDENTE
 * não se candidata, mas continua enxergando o próprio histórico depois de
 * uma eventual suspensão do papel.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const hasProfessionalRole = auth.user.roles.some((r) => r.role === "PROFISSIONAL");
  if (!hasProfessionalRole) {
    return NextResponse.json({ error: "Papel Profissional não ativado nesta conta" }, { status: 409 });
  }

  const statusParam = (new URL(req.url).searchParams.get("status") ?? "").toUpperCase();
  const status = (Object.values(ApplicationStatus) as string[]).includes(statusParam)
    ? (statusParam as ApplicationStatus)
    : undefined;

  const applications = await prisma.application.findMany({
    where: {
      professionalId: auth.user.id,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      jobPosting: {
        select: {
          id: true,
          title: true,
          category: true,
          valueCents: true,
          status: true,
          visibility: true,
          startsAt: true,
          endsAt: true,
          contractor: { select: { id: true, name: true, tradeName: true } },
        },
      },
      hiring: { select: { id: true, status: true, grossValueCents: true, netValueCents: true } },
    },
  });

  return NextResponse.json({ applications });
}
