import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";
import { resolveReport } from "@/services/reportService";

/**
 * POST /api/admin/reports/[id]/resolve
 * Encerra uma denúncia com decisão auditada. Denúncia NUNCA move dinheiro:
 * se dinheiro for o caso, o caminho é abrir/decidir uma disputa.
 *
 * Body: { adminId, outcome: ACAO_TOMADA | ARQUIVADA, decisionNote }
 * `adminId` é exigido só no caminho do segredo interno; vindo da sessão
 * ADMIN do painel, o id auditado é o do próprio usuário logado.
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
  const adminId =
    access.userId ?? (typeof body.adminId === "string" ? body.adminId.trim() : "");
  if (!adminId) {
    return NextResponse.json(
      { error: "adminId é obrigatório (auditoria de quem decidiu)" },
      { status: 400 }
    );
  }

  try {
    const report = await resolveReport({
      reportId: params.id,
      decidedById: adminId,
      outcome: body.outcome as "ACAO_TOMADA" | "ARQUIVADA",
      decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : "",
    });
    await logAdminAction({
      adminAccess: { userId: access.userId, via: access.via },
      action: "REPORT_RESOLVED",
      targetType: "Report",
      targetId: report.id,
      metadata: {
        outcome: body.outcome,
        decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : "",
        adminId,
      },
      request: req,
    });
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao decidir denúncia" },
      { status: 400 }
    );
  }
}
