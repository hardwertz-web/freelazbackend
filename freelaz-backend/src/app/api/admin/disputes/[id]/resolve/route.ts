import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";
import { resolveDispute, type ResolveDisputeParams } from "@/services/disputeService";

/**
 * POST /api/admin/disputes/[id]/resolve
 * Decisão administrativa de uma disputa — a ÚNICA via em que dinheiro move
 * por ação humana, sempre pelo ledger auditado (disputeService).
 *
 * Body: {
 *   adminId: string,              // exigido só no caminho do segredo interno;
 *                                 // vindo da sessão ADMIN do painel, o id
 *                                 // auditado é o do próprio usuário logado
 *   resolution: DEVOLUCAO_TOTAL | LIBERACAO_TOTAL | DIVISAO,
 *   splitPercentToProfessional?: 1..99,  // só em DIVISAO
 *   decisionNote: string          // justificativa obrigatória
 * }
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
    // corpo vazio: o required abaixo causa 400 com mensagem clara
  }
  // Sessão do painel audita o próprio usuário; no caminho do segredo, o
  // `adminId` do corpo segue obrigatório (compatível com os testes/curl).
  const adminId =
    access.userId ?? (typeof body.adminId === "string" ? body.adminId.trim() : "");
  if (!adminId) {
    return NextResponse.json(
      { error: "adminId é obrigatório (auditoria de quem decidiu)" },
      { status: 400 }
    );
  }

  try {
    const result = await resolveDispute({
      disputeId: params.id,
      decidedById: adminId,
      resolution: body.resolution as ResolveDisputeParams["resolution"],
      splitPercentToProfessional:
        typeof body.splitPercentToProfessional === "number"
          ? body.splitPercentToProfessional
          : null,
      decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : "",
    });
    await logAdminAction({
      adminAccess: { userId: access.userId, via: access.via },
      action: "DISPUTE_RESOLVED",
      targetType: "Dispute",
      targetId: params.id,
      metadata: {
        resolution: body.resolution,
        splitPercentToProfessional:
          typeof body.splitPercentToProfessional === "number"
            ? body.splitPercentToProfessional
            : null,
        decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : "",
        adminId,
        payoutId: result.payout?.id ?? null,
      },
      request: req,
    });
    return NextResponse.json({ dispute: result.dispute, payout: result.payout });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao decidir disputa" },
      { status: 400 }
    );
  }
}
