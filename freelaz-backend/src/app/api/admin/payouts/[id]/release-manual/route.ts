import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";
import { releasePayoutManually } from "@/services/payoutService";

/**
 * POST /api/admin/payouts/[id]/release-manual
 *
 * Fallback administrativo para o repasse (ex.: conta do Asaas sem saldo ou
 * transferência recusada): o admin faz o Pix pelo app/banco e confirma aqui.
 * É AÇÃO HUMANA AUDITADA — o `adminId` fica gravado no ledger (`createdBy`).
 *
 * A MESMA proteção transacional do repasse automático se aplica
 * (payoutService.releasePayoutManually): com disputa aberta ou chargeback
 * ativo, a confirmação é RECUSADA. Nenhuma ação manual ignora o bloqueio.
 *
 * Autorização: segredo interno (infra/testes) OU sessão ADMIN (painel), como
 * as demais rotas do painel. O `adminId` auditado vem da sessão; no caminho do
 * segredo, é exigido no corpo (quem confirma é um admin identificado).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // sem corpo: o adminId pode vir da sessão
  }
  const adminId =
    access.via === "session"
      ? access.userId
      : typeof body.adminId === "string"
        ? body.adminId
        : null;
  if (!adminId) {
    return NextResponse.json(
      { error: "adminId é obrigatório no caminho do segredo interno" },
      { status: 400 }
    );
  }

  try {
    await releasePayoutManually(params.id, adminId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro desconhecido" },
      { status: 422 }
    );
  }

  // Pós-commit: falha aqui não pode transformar um repasse já confirmado em
  // erro (o admin reenviaria achando que falhou). A auditoria engole o próprio
  // erro; o unique read é só metadado.
  try {
    const payout = await prisma.payout.findUnique({
      where: { hiringId: params.id },
      select: { id: true, amountCents: true, status: true },
    });
    await logAdminAction({
      adminAccess: { userId: access.userId, via: access.via },
      action: "PAYOUT_RELEASED_MANUAL",
      targetType: "Payout",
      targetId: payout?.id ?? params.id,
      metadata: {
        hiringId: params.id,
        amountCents: payout?.amountCents ?? null,
        payoutStatus: payout?.status ?? null,
        adminId,
      },
      request: req,
    });
  } catch (err) {
    console.error("[admin] falha ao auditar release-manual:", err);
  }

  return NextResponse.json({ released: true });
}
