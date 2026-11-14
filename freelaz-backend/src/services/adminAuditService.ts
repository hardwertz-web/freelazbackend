import { prisma } from "../lib/prisma";
import type { Db } from "../lib/db";
import type { AdminAuditAction, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

/**
 * Serviço de auditoria administrativa (Fase 5).
 *
 * Registra ação sensível executada por admin (sessão ADMIN) ou infraestrutura
 * (x-internal-secret). Append-only. Falha em registrar NÃO deve reverter a
 * ação principal — o log é observabilidade, não transação.
 *
 * Uso típico:
 *   await logAdminAction({
 *     adminAccess: access,       // retorno de checkAdminAccess
 *     action: "DISPUTE_RESOLVED",
 *     targetType: "Dispute",
 *     targetId: disputeId,
 *     metadata: { resolution, decisionNote },
 *   });
 */

type AdminAccessForLog = {
  userId: string | null;
  via: "session" | "secret";
};

export async function logAdminAction(params: {
  adminAccess: AdminAccessForLog;
  action: AdminAuditAction;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: NextRequest | null;
  db?: Db;
}): Promise<void> {
  const adminId = params.adminAccess.userId ?? "system";
  const ipAddress =
    params.request?.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const userAgent = params.request?.headers.get("user-agent") ?? null;

  try {
    await (params.db ?? prisma).adminAuditLog.create({
      data: {
        adminId,
        adminVia: params.adminAccess.via,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        metadata: (params.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    // Auditoria é observabilidade, não transação: nunca falhar a ação
    // principal por causa de log.
    console.error("[adminAudit] falha ao registrar log:", err);
  }
}
