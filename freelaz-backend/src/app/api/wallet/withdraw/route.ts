import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { instantWithdrawalFeeCents } from "@/lib/fees";
import { getWithdrawalFeeBps } from "@/lib/commission";
import { releasePayout } from "@/services/payoutService";

/**
 * POST /api/wallet/withdraw
 * Saque instantâneo: o profissional recebe na hora (em vez de esperar o lote
 * semanal), pagando a taxa configurável. Só contratação CONCLUIDA e ainda não
 * repassada pode ser sacada assim.
 *
 * O dinheiro só sai pelo `releasePayout` (único ponto que move dinheiro para
 * fora, com Payout + ledger + status na mesma transação).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "PROFISSIONAL")) {
    return NextResponse.json({ error: "Só o papel Profissional pode sacar" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const hiringId = String(body.hiringId ?? "").trim();
  if (!hiringId) {
    return NextResponse.json({ error: "hiringId é obrigatório" }, { status: 400 });
  }

  const hiring = await prisma.hiring.findUnique({
    where: { id: hiringId },
    include: { payout: true },
  });
  if (!hiring) {
    return NextResponse.json({ error: "Contratação não encontrada" }, { status: 404 });
  }
  if (hiring.professionalId !== auth.user.id) {
    return NextResponse.json({ error: "Esta contratação não é sua" }, { status: 403 });
  }
  if (hiring.status !== "CONCLUIDO") {
    return NextResponse.json(
      { error: `Só se saca de contratação CONCLUIDA (status atual: ${hiring.status})` },
      { status: 409 }
    );
  }
  if (hiring.payout && hiring.payout.status !== "FALHOU") {
    return NextResponse.json({ error: "Este repasse já foi solicitado" }, { status: 409 });
  }

  // Fase 5b: taxa do saque vem da configuração editável (bps sobre o líquido).
  const feeBps = await getWithdrawalFeeBps();
  const feeCents = instantWithdrawalFeeCents(hiring.netValueCents, feeBps);

  try {
    const payout = await releasePayout(hiring.id, { feeCents, reason: "saque_instantaneo" });
    return NextResponse.json({
      payout: {
        id: payout.id,
        status: payout.status,
        amountCents: payout.amountCents,
        providerTransferId: payout.providerTransferId,
      },
      grossNetCents: hiring.netValueCents,
      feeCents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
