import { NextRequest, NextResponse } from "next/server";
import { isAdmin, requireUser } from "@/lib/auth";
import { sideOfHiring } from "@/lib/hiringAccess";
import { prisma } from "@/lib/prisma";
import { cancelHiring } from "@/services/matchService";

const CANCEL_ORIGINS = ["CONTRACTOR", "PROFESSIONAL", "SYSTEM", "FORCE_MAJEURE"] as const;
type CancelOrigin = (typeof CANCEL_ORIGINS)[number];

/**
 * POST /api/hirings/[id]/cancel — caminho ÚNICO de cancelamento (fluxograma
 * X6: desistência do profissional OU desacordo no chat). Toda origem passa
 * pela MESMA política em matchService.cancelHiring — aqui validamos quem
 * pode chamar e o estado permitido antes da conclusão.
 *
 * Origin deduzida pelo papel: contratante→CONTRACTOR, profissional→PROFESSIONAL,
 * admin→FORCE_MAJEURE (padrão). Apenas admin pode sobrescrever `body.origin`.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const hiring = await prisma.hiring.findUnique({
    where: { id: params.id },
    select: { id: true, contractorId: true, professionalId: true, status: true },
  });
  if (!hiring) {
    return NextResponse.json({ error: "Contratação não encontrada" }, { status: 404 });
  }

  const side = sideOfHiring(hiring, auth.user.id);
  const admin = isAdmin(auth.user);
  if (!side && !admin) {
    return NextResponse.json({ error: "Você não participa desta contratação" }, { status: 403 });
  }

  // Cancelar depois da conclusão não existe: de CONCLUIDO em diante o
  // caminho é a disputa (a conclusão já aconteceu e o dinheiro está retido).
  const cancellable = ["AGUARDANDO_PAGAMENTO", "RETIDO", "EM_ANDAMENTO"];
  if (!cancellable.includes(hiring.status)) {
    return NextResponse.json(
      {
        error: `Cancelamento disponível antes da conclusão (status atual: ${hiring.status}) — depois disso, abra uma disputa`,
      },
      { status: 409 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio é aceito: motivo é opcional
  }
  const reasonNote = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

  let origin: CancelOrigin;
  if (admin) {
    const bodyOrigin = typeof body.origin === "string" ? body.origin : null;
    origin =
      bodyOrigin && (CANCEL_ORIGINS as readonly string[]).includes(bodyOrigin)
        ? (bodyOrigin as CancelOrigin)
        : "FORCE_MAJEURE";
  } else {
    origin = side === "PROFESSIONAL" ? "PROFESSIONAL" : "CONTRACTOR";
  }

  const result = await cancelHiring({
    hiringId: hiring.id,
    origin,
    reason: reasonNote ?? undefined,
  });

  return NextResponse.json({
    canceled: true,
    feeCents: result.feeCents,
    refundCents: result.refundCents,
    feePercent: result.feePercent,
  });
}
