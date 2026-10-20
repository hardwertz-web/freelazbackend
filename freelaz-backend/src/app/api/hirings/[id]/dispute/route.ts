import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { openDispute } from "@/services/disputeService";

/**
 * GET /api/hirings/[id]/dispute — histórico de disputas da contratação
 * (evidências inclusas), só para as duas partes.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });

  const disputes = await prisma.dispute.findMany({
    where: { hiringId: access.hiring.id },
    orderBy: { createdAt: "desc" },
    include: { evidences: true },
  });
  return NextResponse.json({ disputes });
}

/**
 * POST /api/hirings/[id]/dispute — abre uma disputa (parte contratante OU
 * profissional). A abertura vira a contratação EM_DISPUTA: o dinheiro fica
 * parado e o chat continua aberto até a decisão administrativa.
 *
 * Body: { reason: string }  (obrigatório — o protocolo exige o "porquê")
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: o required abaixo causa 400 com mensagem clara
  }
  const reason = typeof body.reason === "string" ? body.reason : "";

  try {
    const dispute = await openDispute({
      hiringId: access.hiring.id,
      openedById: access.user.id,
      reason,
    });
    return NextResponse.json({ dispute }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao abrir disputa" },
      { status: 400 }
    );
  }
}
