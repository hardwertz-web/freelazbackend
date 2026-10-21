import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSubaccountForUser } from "@/services/subaccountService";

/**
 * POST /api/profile/subaccount — onboarding de subconta Asaas (Etapa 7.3b).
 *
 * - Session obrigatória (401) e papel PROFISSIONAL ATIVO (403).
 * - Feature flag `ASAAS_SUBACCOUNT_ENABLED` === "true" (default OFF): com a
 *   flag desligada responde 503 e NÃO chama o serviço/provedor.
 * - Perfil incompleto → 400 `{ ok:false, missing:[...] }`.
 * - Sucesso → 200 `{ ok:true, subaccountId, status, skipped }`.
 *
 * 🔒 A `apiKey` da subconta (e `incomeValueCents`) nunca aparecem na resposta
 * nem em log.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const isActiveProfessional = user.roles.some(
    (r) => r.role === "PROFISSIONAL" && r.status === "ATIVO"
  );
  if (!isActiveProfessional) {
    return NextResponse.json(
      { error: "Apenas profissional ativo pode criar subconta" },
      { status: 403 }
    );
  }

  if (process.env.ASAAS_SUBACCOUNT_ENABLED !== "true") {
    return NextResponse.json({ error: "Subcontas desabilitadas" }, { status: 503 });
  }

  const result = await createSubaccountForUser(user.id);

  if (!result.ok) {
    if ("missing" in result) {
      return NextResponse.json({ ok: false, missing: result.missing }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    subaccountId: result.subaccountId,
    status: result.status,
    skipped: result.skipped,
  });
}
