import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess } from "@/lib/internalAuth";
import { listReports } from "@/services/reportService";

/**
 * GET /api/admin/reports?status=ABERTA
 * Fila administrativa de denúncias — SEPARADA das disputas e com prioridade
 * (ABUSO primeiro). Aceita o segredo interno (infra/testes) ou sessão de
 * conta com papel ADMIN (painel).
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const reports = await listReports(statusParam ? statusParam.toUpperCase() : undefined);
  return NextResponse.json({ reports });
}
