import { NextRequest, NextResponse } from "next/server";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { cancelHiring } from "@/services/matchService";
import { getRetainedBalance } from "@/services/ledgerService";

/**
 * POST /api/hirings/[id]/cancel — caminho ÚNICO de cancelamento (fluxograma
 * X6: desistência do profissional OU desacordo no chat). Toda origem passa
 * pela MESMA política em matchService.cancelHiring — aqui só validamos quem
 * pode chamar, em que estado, e calculamos o reembolso.
 *
 * Reembolso: 100% do saldo retido (decisão de produto registrada em
 * findings.md — sem multa enquanto o produto não define faixas; o protocolo
 * proíbe inventar penalidades).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });
  const { hiring, user } = access;

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

  const refundAmountCents = await getRetainedBalance(hiring.id);

  await cancelHiring({
    hiringId: hiring.id,
    initiatedBy: user.id,
    refundAmountCents, // 100% do saldo retido — decisão de produto
    reasonNote: reasonNote ?? undefined,
  });

  return NextResponse.json({
    canceled: true,
    refundAmountCents,
  });
}
