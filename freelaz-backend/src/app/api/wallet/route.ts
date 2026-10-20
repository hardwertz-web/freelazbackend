import { NextRequest, NextResponse } from "next/server";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { getProfessionalWallet, getProfessionalStatement } from "@/services/walletService";
import { instantWithdrawalFeeBps } from "@/lib/fees";

/**
 * GET /api/wallet
 * Carteira + extrato do profissional logado (leitura pura).
 * `limit` controla quantos lançamentos recentes do extrato voltam (1 a 100).
 *
 * A tela ainda não existe (depende do protótipo visual) — esta é a rota de
 * leitura que a alimenta.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "PROFISSIONAL")) {
    return NextResponse.json({ error: "Só o papel Profissional tem carteira" }, { status: 403 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;

  const [wallet, statement] = await Promise.all([
    getProfessionalWallet(auth.user.id),
    getProfessionalStatement(auth.user.id, limit),
  ]);

  return NextResponse.json({
    wallet: { ...wallet, instantWithdrawalFeeBps: instantWithdrawalFeeBps() },
    statement,
  });
}
