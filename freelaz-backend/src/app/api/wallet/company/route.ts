import { NextRequest, NextResponse } from "next/server";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { getCompanyStatement } from "@/services/companyWalletService";

/**
 * GET /api/wallet/company?limit=50
 * Carteira + extrato da empresa (contratante logado). Leitura pura.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Só o papel Contratante tem carteira empresarial" }, { status: 403 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;

  const result = await getCompanyStatement(auth.user.id, limit);
  return NextResponse.json({
    availableCents: result.availableCents,
    creditedCents: result.creditedCents,
    debitedCents: result.debitedCents,
    entries: result.entries,
  });
}
