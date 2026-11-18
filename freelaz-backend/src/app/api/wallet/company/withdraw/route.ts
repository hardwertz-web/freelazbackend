import { NextRequest, NextResponse } from "next/server";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { withdrawCompanyBalance } from "@/services/companyWithdrawalService";

/** POST /api/wallet/company/withdraw — saque da carteira da empresa via Pix. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Só o papel Contratante tem carteira empresarial" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* 400 abaixo */
  }

  const amountCents = typeof body.amountCents === "number" ? body.amountCents : NaN;
  const pixKey = typeof body.pixKey === "string" ? body.pixKey : "";

  const outcome = await withdrawCompanyBalance({ contractorId: auth.user.id, amountCents, pixKey });

  switch (outcome.kind) {
    case "ok":
      return NextResponse.json({
        withdrawalId: outcome.withdrawalId,
        providerTransferId: outcome.providerTransferId,
      });
    case "invalid_amount":
      return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
    case "invalid_pix_key":
      return NextResponse.json({ error: "Chave Pix inválida" }, { status: 400 });
    case "below_minimum":
      return NextResponse.json(
        { error: `Valor mínimo para saque é R$ ${(outcome.minimumCents / 100).toFixed(2)}` },
        { status: 400 }
      );
    case "insufficient":
      return NextResponse.json(
        { error: `Saldo insuficiente. Disponível: R$ ${(outcome.availableCents / 100).toFixed(2)}` },
        { status: 409 }
      );
    case "chargeback_blocked":
      return NextResponse.json(
        { error: "Saque bloqueado: existe chargeback ativo. Resolva antes de sacar." },
        { status: 409 }
      );
    case "transfer_failed":
      return NextResponse.json(
        { error: `Transferência falhou: ${outcome.message}. O valor foi estornado na carteira.` },
        { status: 502 }
      );
  }
}
