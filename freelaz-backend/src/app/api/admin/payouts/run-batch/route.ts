import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess } from "@/lib/internalAuth";
import { processPendingPayouts } from "@/services/payoutService";

/**
 * POST /api/admin/payouts/run-batch
 * Dispara o lote de repasses pelo painel — o MESMO serviço do cron semanal
 * (`/api/cron/payouts`): elegibilidade (CONCLUIDO + janela de 2h da avaliação
 * + sem payout ou último FALHOU), chave de idempotência e ledger continuam
 * iguais; só muda quem dispara (sessão ADMIN em vez de agendador/segredo).
 * Autorização aceita segredo interno OU sessão ADMIN, como as outras rotas
 * do painel.
 */
export async function POST(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const result = await processPendingPayouts();
  return NextResponse.json({ result });
}
