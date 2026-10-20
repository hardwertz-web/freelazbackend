import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { runReconciliation } from "@/services/reconciliationService";

/**
 * GET /api/admin/reconciliation
 * Relatório de reconciliação ao vivo para o painel — a MESMA rede de
 * segurança do cron diário: só confere e reporta, nunca move nem corrige
 * dinheiro (correção é AJUSTE manual com revisão humana). Junta os erros
 * relevantes para operação: repasses com falha (Payout FALHOU, que o lote
 * retenta) e lançamentos AJUSTE (as correções manuais já feitas).
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const [report, failedPayouts, adjustments] = await Promise.all([
    runReconciliation(),
    prisma.payout.findMany({
      where: { status: "FALHOU" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        hiringId: true,
        amountCents: true,
        failureReason: true,
        providerTransferId: true,
        updatedAt: true
      }
    }),
    prisma.ledgerEntry.findMany({
      where: { type: "AJUSTE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        hiringId: true,
        amountCents: true,
        reason: true,
        createdBy: true,
        createdAt: true
      }
    })
  ]);

  return NextResponse.json({ report, failedPayouts, adjustments });
}
