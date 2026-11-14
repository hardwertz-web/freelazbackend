import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { logAdminAction } from "@/services/adminAuditService";

const MIN_BPS = 0;
const MAX_BPS = 5000;

/**
 * POST /api/admin/companies/[userId]/commission
 * Define comissão customizada para uma empresa (ou limpa voltando ao global).
 *
 * Body: { customCommissionBps: number | null, adminId?: string }
 *  - number entre 0 e 5000 = comissão customizada
 *  - null = remove customização (empresa usa comissão global)
 *
 * IMPORTANTE: só afeta NOVAS contratações. Hirings existentes têm
 * commissionBps congelado.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: o customCommissionBps ausente vira erro de validação abaixo
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

  const rawBps = body.customCommissionBps;
  let customCommissionBps: number | null;
  if (rawBps === null) {
    customCommissionBps = null;
  } else if (typeof rawBps === "number" && Number.isInteger(rawBps)) {
    if (rawBps < MIN_BPS || rawBps > MAX_BPS) {
      return NextResponse.json(
        { error: `customCommissionBps deve estar entre ${MIN_BPS} e ${MAX_BPS}` },
        { status: 400 }
      );
    }
    customCommissionBps = rawBps;
  } else {
    return NextResponse.json(
      { error: "customCommissionBps deve ser inteiro ou null" },
      { status: 400 }
    );
  }

  // Confirma que o usuário existe e é contratante
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      name: true,
      tradeName: true,
      document: true,
      contractorProfile: { select: { customCommissionBps: true, id: true } },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }
  if (!user.contractorProfile) {
    return NextResponse.json(
      { error: "Usuário não tem perfil de contratante" },
      { status: 400 }
    );
  }

  const previousValue = user.contractorProfile.customCommissionBps;

  const updated = await prisma.contractorProfile.update({
    where: { userId: params.userId },
    data: { customCommissionBps },
    select: { userId: true, customCommissionBps: true },
  });

  await logAdminAction({
    adminAccess: { userId: access.userId, via: access.via },
    action: "COMPANY_COMMISSION_CHANGED",
    targetType: "ContractorProfile",
    targetId: params.userId,
    metadata: {
      companyName: user.tradeName ?? user.name,
      document: user.document,
      previousValue,
      newValue: customCommissionBps,
      adminId,
    },
    request: req,
  });

  return NextResponse.json({ contractorProfile: updated });
}
