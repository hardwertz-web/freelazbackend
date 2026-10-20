import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { commissionCentsFor } from "@/lib/commission";

/**
 * GET /api/hirings/:id — detalhe de uma contratação (só as partes).
 * Traz o ledger e o payout porque é a base do "extrato" de cada lado, mas
 * nunca expõe dados da contraparte que não interessam (documento, e-mail).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });
  const { hiring, side } = access;

  const [contractor, professional, evaluations, checkIn, disputes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: hiring.contractorId },
      select: { id: true, name: true, tradeName: true, city: true, state: true },
    }),
    prisma.user.findUnique({
      where: { id: hiring.professionalId },
      select: { id: true, name: true, tradeName: true, city: true, state: true },
    }),
    prisma.evaluation.findMany({
      where: { hiringId: hiring.id },
      include: { author: { select: { id: true, name: true, tradeName: true } } },
    }),
    prisma.checkIn.findUnique({ where: { hiringId: hiring.id } }),
    prisma.dispute.findMany({
      where: { hiringId: hiring.id },
      orderBy: { createdAt: "desc" },
      include: { evidences: true },
    }),
  ]);

  const counterpart = side === "CONTRACTOR" ? professional : contractor;

  return NextResponse.json({
    hiring: {
      id: hiring.id,
      status: hiring.status,
      jobTitle: hiring.jobTitle,
      side,
      grossValueCents: hiring.grossValueCents,
      netValueCents: hiring.netValueCents,
      commissionCents: commissionCentsFor(hiring.grossValueCents, hiring.commissionBps),
      commissionBps: hiring.commissionBps,
      createdAt: hiring.createdAt,
      completedAt: hiring.completedAt,
      disputeOpen: hiring.disputeOpen,
      jobPosting: {
        id: hiring.jobPosting.id,
        title: hiring.jobPosting.title,
        category: hiring.jobPosting.category,
        startsAt: hiring.jobPosting.startsAt,
        endsAt: hiring.jobPosting.endsAt,
        status: hiring.jobPosting.status,
      },
      counterpart,
      chat: hiring.chat
        ? {
            id: hiring.chat.id,
            status: hiring.chat.status,
            openedAt: hiring.chat.openedAt,
            closedAt: hiring.chat.closedAt,
          }
        : null,
      // Códigos de turno: só o profissional precisa mostrar o código; a empresa
      // confere. Não são segredo entre as partes, então podem sair aqui.
      openingCode: hiring.openingCode,
      closingCode: hiring.closingCode,
      closingCodeUsedAt: hiring.closingCodeUsedAt,
      ledger: hiring.ledgerEntries
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      payout: hiring.payout,
      evaluations,
      checkIn,
      disputes,
    },
  });
}
