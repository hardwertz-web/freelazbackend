import { NextRequest, NextResponse } from "next/server";
import { releasePayout } from "@/services/payoutService";
import { checkInternalSecret } from "@/lib/internalAuth";

/**
 * POST /api/payouts/release
 * Dispara a liberação do pagamento retido de uma contratação concluída.
 * Chamada automaticamente pelo fluxo de conclusão de serviço (checklist:
 * check-in + checkout + sem disputa aberta) — nunca por ação manual livre
 * de um admin, conforme a Governança Financeira do CLAUDE.md.
 *
 * Rota interna: travada por segredo (header x-internal-secret), sem sessão de
 * usuário — liberação de dinheiro não é ação de conta comum. O repasse
 * automático em lote usa o mesmo serviço via `/api/cron/payouts`.
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalSecret(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const { hiringId } = await req.json();

  if (!hiringId) {
    return NextResponse.json({ error: "hiringId é obrigatório" }, { status: 400 });
  }

  try {
    await releasePayout(hiringId);
    return NextResponse.json({ released: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
