import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { selectCandidate } from "@/services/jobPostingService";
import { requireApplicationParty } from "@/lib/applicationAccess";

/**
 * POST /api/applications/:id/respond
 * Body: { decision: "ACCEPT" | "REJECT" }
 *
 * Aceitar: se havia contraproposta pendente, o valor negociado vira o
 * `agreedValueCents` final; chama selectCandidate para fechar a seleção
 * (os demais candidatos da mesma vaga viram SUPLENTE). Daqui o fluxo segue
 * para o passo 5 do CLAUDE.md (pagamento).
 *
 * Recusar:
 * - Profissional recusando → candidatura DESISTIU (ele sai do processo)
 * - Contratante recusando a contraproposta → a oferta é retirada e a
 *   candidatura volta a PENDENTE: a vaga continua aberta e nada muda
 *   (CLAUDE.md, passo 4)
 *
 * O lado que responde vem da sessão, nunca do corpo da requisição.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireApplicationParty(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });

  const { decision } = await req.json();
  if (decision !== "ACCEPT" && decision !== "REJECT") {
    return NextResponse.json({ error: "decision deve ser ACCEPT ou REJECT" }, { status: 400 });
  }

  if (access.application.status !== "PENDENTE" && access.application.status !== "CONTRAPROPOSTA") {
    return NextResponse.json(
      { error: "Esta candidatura não está mais aberta a negociação" },
      { status: 409 }
    );
  }

  if (decision === "REJECT") {
    if (access.side === "PROFESSIONAL") {
      const updated = await prisma.application.update({
        where: { id: params.id },
        data: { status: "DESISTIU" },
      });
      return NextResponse.json({ application: updated, decision: "DESISTIU" });
    }

    // Contratante retira a própria contraproposta: candidatura segue viva.
    const updated = await prisma.application.update({
      where: { id: params.id },
      data: { status: "PENDENTE", counterOfferValueCents: null, counterOfferBy: null },
    });
    return NextResponse.json({ application: updated, decision: "OFERTA_RETIRADA" });
  }

  const agreedValueCents =
    access.application.counterOfferValueCents ?? access.application.jobPosting.valueCents;

  await prisma.application.update({
    where: { id: params.id },
    data: { agreedValueCents },
  });

  const selected = await selectCandidate(params.id);

  // Próximo passo é a criação do pagamento (ver /api/payments/create),
  // disparado pelo frontend assim que a seleção/aceite acontece aqui.
  return NextResponse.json({ application: selected, agreedValueCents });
}
