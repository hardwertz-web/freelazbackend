import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";
import { updateSetting } from "@/services/settingsService";

/**
 * POST /api/admin/settings/[key]
 * Altera uma configuração financeira editável (Fase 5b).
 *
 * Body: { value: string | number, previousValue?: string, adminId?: string }
 * - `value` é validado por faixa em `updateSetting` (commission_bps 0–5000,
 *   boost_price_cents 100–10000, withdrawal_fee_bps 0–1000).
 * - `previousValue` é metadado de auditoria (o valor que a tela mostrou antes).
 * - `adminId` é exigido só no caminho do segredo interno; pela sessão ADMIN do
 *   painel, o id auditado é o do usuário logado.
 *
 * A alteração afeta apenas NOVAS operações: comissão já congelada em
 * Hiring.commissionBps e cobranças já criadas não mudam.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: o value ausente vira erro de validação abaixo
  }

  const adminId =
    access.userId ??
    (typeof body.adminId === "string" ? body.adminId.trim() : "");
  if (!adminId) {
    return NextResponse.json(
      { error: "adminId é obrigatório quando via x-internal-secret" },
      { status: 400 }
    );
  }

  const value =
    typeof body.value === "string" ? body.value : String(body.value ?? "");
  const previousValue =
    typeof body.previousValue === "string" ? body.previousValue : null;

  let updated;
  try {
    updated = await updateSetting({
      key: params.key,
      value,
      updatedById: adminId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao atualizar" },
      { status: 400 }
    );
  }

  await logAdminAction({
    adminAccess: { userId: access.userId, via: access.via },
    action: "SETTING_CHANGED",
    targetType: "PlatformSetting",
    targetId: params.key,
    metadata: {
      previousValue,
      newValue: updated.value,
      adminId,
    },
    request: req,
  });

  return NextResponse.json({ setting: updated });
}
