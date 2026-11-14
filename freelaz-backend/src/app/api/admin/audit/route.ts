import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { AdminAuditAction, type Prisma } from "@prisma/client";

/**
 * GET /api/admin/audit
 * Lista a trilha de auditoria administrativa com filtros opcionais.
 *
 * Query: ?action=DISPUTE_RESOLVED&targetType=Hiring&targetId=xxx&adminId=yyy&limit=100
 *
 * Somente leitura — a trilha é append-only, gravada por `logAdminAction`.
 * `limit` é limitado a 500 para não puxar a tabela inteira no painel.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const targetType = searchParams.get("targetType");
  const targetId = searchParams.get("targetId");
  const adminId = searchParams.get("adminId");
  const limit = Math.min(
    Number.parseInt(searchParams.get("limit") ?? "100", 10) || 100,
    500
  );

  const where: Prisma.AdminAuditLogWhereInput = {};
  if (action) {
    if (!Object.values(AdminAuditAction).includes(action as AdminAuditAction)) {
      return NextResponse.json(
        { error: `action inválida: ${action}` },
        { status: 400 }
      );
    }
    where.action = action as AdminAuditAction;
  }
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (adminId) where.adminId = adminId;

  const entries = await prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ entries });
}
