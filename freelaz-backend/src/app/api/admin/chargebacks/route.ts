import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * GET /api/admin/chargebacks?state=ATIVO&take=50
 * Fila administrativa de CHARGEBACKS externos do Asaas.
 *
 * Reutiliza o mesmo guard dos outros endpoints admin (`checkAdminAccess`:
 * segredo interno da infra/testes OU sessão de conta ADMIN). É SOMENTE
 * CONSULTA — nenhuma ação aqui move dinheiro. A resolução financeira de um
 * chargeback depende de política de negócio aprovada (ver findings.md > D1–D8)
 * e é feita pelos fluxos auditados existentes (disputa/payout manual).
 *
 * Segurança: nunca devolve o payload bruto (que pode conter dados do
 * portador); só o hash e os campos de correlação.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const state = searchParams.get("state");
  const takeParam = Number(searchParams.get("take") ?? "50");
  const take = Math.min(Math.max(Number.isFinite(takeParam) ? takeParam : 50, 1), 100);

  const chargebacks = await prisma.chargebackEvent.findMany({
    where: state ? { state: state.toUpperCase() } : undefined,
    orderBy: { receivedAt: "desc" },
    take,
    include: {
      hiring: {
        select: {
          id: true,
          jobTitle: true,
          status: true,
          grossValueCents: true,
          netValueCents: true,
          disputeOpen: true,
        },
      },
      asaasEvent: {
        select: { asaasEventId: true, event: true, processingStatus: true, receivedAt: true },
      },
    },
  });

  // Eventos que o processamento NÃO concluiu com efeito — visíveis para
  // investigação (nunca descartados silenciosamente).
  const problematicEvents = await prisma.asaasEvent.findMany({
    where: { processingStatus: { in: ["FALHA", "NAO_TRATADO"] } },
    orderBy: { receivedAt: "desc" },
    take,
    select: {
      id: true,
      asaasEventId: true,
      event: true,
      paymentId: true,
      externalReference: true,
      processingStatus: true,
      actionTaken: true,
      errorMessage: true,
      receivedAt: true,
      processedAt: true,
    },
  });

  return NextResponse.json({ chargebacks, problematicEvents });
}
