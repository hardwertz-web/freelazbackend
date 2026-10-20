import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicationParty } from "@/lib/applicationAccess";
import { notifyAndDispatch } from "@/services/notificationService";

/**
 * POST /api/applications/:id/counter-offer
 * Body: { valueCents }
 *
 * Qualquer uma das partes pode propor um novo valor — ida e volta livre até
 * alguém aceitar (ver /respond) ou desistir. Não há limite de rodadas:
 * cada chamada apenas substitui a última oferta pendente.
 *
 * O lado que propõe é SEMPRE deduzido da sessão (nunca vem do corpo) —
 * senão um profissional conseguiria se passar pelo contratante.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireApplicationParty(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });

  const { valueCents } = await req.json();
  if (!Number.isInteger(valueCents) || valueCents <= 0) {
    return NextResponse.json({ error: "valueCents deve ser inteiro positivo (centavos)" }, { status: 422 });
  }

  if (access.application.status !== "PENDENTE" && access.application.status !== "CONTRAPROPOSTA") {
    return NextResponse.json(
      { error: "Esta candidatura não está mais aberta a negociação" },
      { status: 409 }
    );
  }

  // Não faz sentido a mesma parte propor contraproposta para si mesma em
  // cima da própria última oferta? Isso é permitido (ela pode corrigir o
  // valor antes da resposta da outra parte), mas o lado registrado é o real.
  const updated = await prisma.application.update({
    where: { id: params.id },
    data: {
      status: "CONTRAPROPOSTA",
      counterOfferValueCents: valueCents,
      counterOfferBy: access.side,
    },
  });

  // Etapa 7: notifica a OUTRA parte (quem não propôs). Try/catch — falha de
  // notificação não derruba a contraproposta.
  const targetUserId =
    access.side === "CONTRACTOR"
      ? access.application.professionalId
      : access.application.jobPosting.contractorId;
  try {
    await notifyAndDispatch({
      userId: targetUserId,
      type: "COUNTER_PROPOSAL_RECEIVED",
      title: "Você recebeu uma contraproposta",
      body: `Nova proposta de R$ ${(valueCents / 100).toFixed(2)} para a vaga "${access.application.jobPosting.title}".`,
      payload: {
        applicationId: updated.id,
        jobPostingId: access.application.jobPostingId,
        jobTitle: access.application.jobPosting.title,
        valueCents,
        counterOfferBy: access.side,
      },
      dedupeKey: `counter:${updated.id}:${access.side}`,
    });
  } catch (err) {
    console.warn(
      `[counter-offer] falha ao notificar (application ${updated.id}): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return NextResponse.json({ application: updated });
}
