import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";
import {
  recordAdjustment,
  getRetainedBalance,
  getAdjustedBalance,
} from "@/services/ledgerService";

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 1000;

/**
 * POST /api/admin/ledger/adjust
 * Cria um AJUSTE manual auditado (correção de divergência de reconciliação).
 *
 * Body: {
 *   hiringId: string,
 *   amountCents: number (SEMPRE positivo, sem sinal),
 *   direction: "RELEASE_TO_PROFESSIONAL" | "REFUND_TO_COMPANY",
 *   reason: string (>= 10 chars, obrigatória),
 *   adminId?: string (obrigatório quando via x-internal-secret),
 * }
 *
 * Regra de negócio (Governança Financeira):
 * - `amountCents` é sempre positivo; `direction` é só metadado e compõe a
 *   `reason` do lançamento. Ambos (release/refund) REDUZEM o saldo AJUSTADO
 *   em `amountCents` — o ajuste é uma correção contábil, não dinheiro novo.
 * - O saldo operacional (`getRetainedBalance`) NÃO muda com AJUSTE; só o
 *   ajustado (`getAdjustedBalance = operacional - sum(AJUSTE)`) muda.
 * - O guard usa o saldo AJUSTADO: é ele que não pode ficar negativo. O
 *   operacional pode ficar negativo por desenho se já houver AJUSTE — e a
 *   reconciliação acusa isso no check `saldo_ajustado_nao_negativo`.
 */
export async function POST(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const hiringId = typeof body.hiringId === "string" ? body.hiringId.trim() : "";
  const amountCents =
    typeof body.amountCents === "number" ? body.amountCents : NaN;
  const direction = typeof body.direction === "string" ? body.direction : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!hiringId) {
    return NextResponse.json({ error: "hiringId obrigatório" }, { status: 400 });
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json(
      { error: "amountCents deve ser inteiro positivo" },
      { status: 400 }
    );
  }
  if (
    direction !== "RELEASE_TO_PROFESSIONAL" &&
    direction !== "REFUND_TO_COMPANY"
  ) {
    return NextResponse.json(
      {
        error:
          "direction deve ser RELEASE_TO_PROFESSIONAL ou REFUND_TO_COMPANY",
      },
      { status: 400 }
    );
  }
  if (reason.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      { error: `reason precisa ter pelo menos ${MIN_REASON_LENGTH} caracteres` },
      { status: 400 }
    );
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json(
      { error: `reason não pode passar de ${MAX_REASON_LENGTH} caracteres` },
      { status: 400 }
    );
  }

  // adminId: sessão ADMIN vem do próprio usuário; no caminho do segredo
  // interno é exigido no corpo (quem assina o ajuste é um admin identificado —
  // o ledger recusa createdBy "system").
  const adminId =
    access.userId ??
    (typeof body.adminId === "string" ? body.adminId.trim() : "");
  if (!adminId) {
    return NextResponse.json(
      { error: "adminId é obrigatório quando via x-internal-secret" },
      { status: 400 }
    );
  }

  const hiring = await prisma.hiring.findUnique({
    where: { id: hiringId },
    select: { id: true, jobTitle: true, status: true },
  });
  if (!hiring) {
    return NextResponse.json(
      { error: "Contratação não encontrada" },
      { status: 404 }
    );
  }

  const [operationalBefore, adjustedBefore] = await Promise.all([
    getRetainedBalance(hiringId),
    getAdjustedBalance(hiringId),
  ]);

  // Guard: o saldo AJUSTADO não pode ficar negativo. O operacional pode.
  if (amountCents > adjustedBefore) {
    return NextResponse.json(
      {
        error: `amountCents (${amountCents}) excede o saldo ajustado atual (${adjustedBefore})`,
        adjustedCents: adjustedBefore,
      },
      { status: 409 }
    );
  }

  const fullReason = `ajuste_manual:${direction}:${reason}`;

  let entry;
  try {
    entry = await prisma.$transaction(async (tx) => {
      return recordAdjustment(hiringId, amountCents, fullReason, adminId, tx);
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao criar ajuste" },
      { status: 400 }
    );
  }

  // Pós-commit: nada aqui pode transformar um ajuste já gravado em erro HTTP.
  const [operationalAfter, adjustedAfter] = await Promise.all([
    getRetainedBalance(hiringId),
    getAdjustedBalance(hiringId),
  ]);

  await logAdminAction({
    adminAccess: { userId: access.userId, via: access.via },
    action: "ADJUSTMENT_CREATED",
    targetType: "Hiring",
    targetId: hiringId,
    metadata: {
      hiringTitle: hiring.jobTitle,
      hiringStatus: hiring.status,
      direction,
      amountCents,
      adminId,
      operationalBeforeCents: operationalBefore,
      operationalAfterCents: operationalAfter,
      adjustedBeforeCents: adjustedBefore,
      adjustedAfterCents: adjustedAfter,
      reason,
      entryId: entry.id,
    },
    request: req,
  });

  return NextResponse.json(
    {
      adjustment: entry,
      operationalBeforeCents: operationalBefore,
      operationalAfterCents: operationalAfter,
      adjustedBeforeCents: adjustedBefore,
      adjustedAfterCents: adjustedAfter,
    },
    { status: 201 }
  );
}
