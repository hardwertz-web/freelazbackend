import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ACTIVE_PROPOSAL_STATUSES } from "@/services/proposalService";

/**
 * GET /api/proposals — propostas privadas ("Me contrate") da sessão (Fase 2.5).
 *
 * Existe porque `GET /api/applications` cobre apenas o lado Profissional
 * (candidaturas enviadas). Aqui o mesmo endpoint serve os dois lados:
 * - profissional → propostas RECEBIDAS;
 * - contratante  → propostas ENVIADAS.
 * Quem tem os dois papéis vê os dois conjuntos (sem duplicar a mesma linha).
 *
 * Só propostas PRIVADAS vivas (PENDENTE/CONTRAPROPOSTA). O status e o lado são
 * derivados da sessão; nunca vêm do cliente.
 *
 * `counts.pending` conta apenas o que aguarda a resposta DESTE usuário (é o
 * número usado no badge da aba Mensagens). Não é um contador de "não lidas".
 */
export async function GET(_req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json(auth.error.body, { status: auth.error.status });
  }
  const user = auth.user;

  const isProfessional = user.roles.some((role) => role.role === "PROFISSIONAL");
  const isContractor = user.roles.some((role) => role.role === "CONTRATANTE");

  const empty = {
    proposals: [],
    counts: { pending: 0, received: 0, sent: 0, active: 0 },
  };
  if (!isProfessional && !isContractor) {
    return NextResponse.json(empty);
  }

  const where: Prisma.ApplicationWhereInput = {
    status: { in: ACTIVE_PROPOSAL_STATUSES },
    OR: [
      ...(isProfessional
        ? [
            {
              professionalId: user.id,
              jobPosting: { is: { visibility: "PRIVADA" as const } },
            },
          ]
        : []),
      ...(isContractor
        ? [
            {
              jobPosting: {
                is: {
                  visibility: "PRIVADA" as const,
                  contractorId: user.id,
                },
              },
            },
          ]
        : []),
    ],
  };

  const applications = await prisma.application.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      jobPosting: {
        select: {
          id: true,
          title: true,
          category: true,
          city: true,
          state: true,
          valueCents: true,
          startsAt: true,
          endsAt: true,
          status: true,
          contractorId: true,
          contractor: { select: { id: true, name: true, tradeName: true } },
        },
      },
      professional: { select: { id: true, name: true, tradeName: true } },
      hiring: { select: { id: true, status: true } },
    },
  });

  const proposals = applications.map((application) => {
    const professionalSide = application.professionalId === user.id;
    const contractorSide = application.jobPosting.contractorId === user.id;
    // Se a mesma conta ocupa os dois lados (auto-contratação antiga), tratamos
    // como ENVIADA para não duplicar a leitura.
    const side =
      professionalSide && !contractorSide ? "RECEIVED" : "SENT";

    const awaitingMe =
      side === "RECEIVED"
        ? application.status === "PENDENTE" ||
          (application.status === "CONTRAPROPOSTA" &&
            application.counterOfferBy !== "PROFESSIONAL")
        : application.status === "CONTRAPROPOSTA" &&
          application.counterOfferBy === "PROFESSIONAL";

    const counterpart =
      side === "RECEIVED"
        ? application.jobPosting.contractor
        : application.professional;

    return {
      id: application.id,
      status: application.status,
      side,
      awaitingMe,
      message: application.message,
      valueCents:
        application.counterOfferValueCents ?? application.jobPosting.valueCents,
      counterOfferValueCents: application.counterOfferValueCents,
      counterOfferBy: application.counterOfferBy,
      agreedValueCents: application.agreedValueCents,
      createdAt: application.createdAt,
      counterpart: {
        id: counterpart.id,
        name: counterpart.name,
        tradeName: counterpart.tradeName,
      },
      jobPosting: {
        id: application.jobPosting.id,
        title: application.jobPosting.title,
        category: application.jobPosting.category,
        city: application.jobPosting.city,
        state: application.jobPosting.state,
        valueCents: application.jobPosting.valueCents,
        startsAt: application.jobPosting.startsAt,
        endsAt: application.jobPosting.endsAt,
        status: application.jobPosting.status,
      },
      hiring: application.hiring,
    };
  });

  const counts = proposals.reduce(
    (acc, proposal) => {
      acc.active += 1;
      if (proposal.side === "RECEIVED") acc.received += 1;
      else acc.sent += 1;
      if (proposal.awaitingMe) acc.pending += 1;
      return acc;
    },
    { pending: 0, received: 0, sent: 0, active: 0 }
  );

  return NextResponse.json({ proposals, counts: { ...counts, unread: counts.pending } });
}
