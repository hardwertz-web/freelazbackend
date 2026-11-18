import { NextRequest, NextResponse } from "next/server";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  const [statement, withdrawals] = await Promise.all([
    getCompanyStatement(auth.user.id, limit),
    prisma.companyWithdrawal.findMany({
      where: { contractorId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({
    availableCents: statement.availableCents,
    creditedCents: statement.creditedCents,
    debitedCents: statement.debitedCents,
    entries: statement.entries,
    withdrawals,
  });
}
