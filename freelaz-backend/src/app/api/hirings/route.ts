import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ACTIVE_HIRING_STATUSES } from "@/services/hiringService";

/**
 * GET /api/hirings — "minhas contratações" (empresa e profissional).
 *
 * Necessário para o loop fechar: depois do aceite/seleção, é daqui que a
 * empresa descobre o `hiringId` para chamar `/api/payments/create` e é daqui
 * que os dois lados encontram o chat.
 *
 * Filtros: `side` (CONTRACTOR | PROFESSIONAL) e `status` (ou `active=1` para
 * só as que ainda têm dinheiro/serviço em jogo).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { searchParams } = new URL(req.url);
  const side = (searchParams.get("side") ?? "").toUpperCase();
  const status = (searchParams.get("status") ?? "").toUpperCase();
  const activeOnly = searchParams.get("active") === "1";

  const asContractor = side === "CONTRACTOR" || !side;
  const asProfessional = side === "PROFESSIONAL" || !side;

  const hirings = await prisma.hiring.findMany({
    where: {
      AND: [
        {
          OR: [
            ...(asContractor ? [{ contractorId: auth.user.id }] : []),
            ...(asProfessional ? [{ professionalId: auth.user.id }] : []),
          ],
        },
        ...(status ? [{ status }] : []),
        ...(activeOnly ? [{ status: { in: ACTIVE_HIRING_STATUSES } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      jobTitle: true,
      grossValueCents: true,
      netValueCents: true,
      commissionBps: true,
      createdAt: true,
      completedAt: true,
      contractorId: true,
      professionalId: true,
      jobPosting: {
        select: { id: true, title: true, category: true, startsAt: true, endsAt: true, status: true },
      },
      chat: { select: { id: true, status: true, lastMessageAt: true } },
      contractor: { select: { id: true, name: true, tradeName: true } },
      professional: { select: { id: true, name: true, tradeName: true } },
    },
  });

  return NextResponse.json({
    hirings: hirings.map((hiring) => {
      const viewerSide = hiring.contractorId === auth.user.id ? "CONTRACTOR" : "PROFESSIONAL";
      return {
        id: hiring.id,
        status: hiring.status,
        jobTitle: hiring.jobTitle,
        grossValueCents: hiring.grossValueCents,
        netValueCents: hiring.netValueCents,
        commissionBps: hiring.commissionBps,
        createdAt: hiring.createdAt,
        completedAt: hiring.completedAt,
        side: viewerSide,
        jobPosting: hiring.jobPosting,
        chat: hiring.chat,
        // Só a contraparte — nunca a própria conta (o front já sabe quem é).
        counterpart:
          viewerSide === "CONTRACTOR"
            ? {
                id: hiring.professional.id,
                name: hiring.professional.name,
                tradeName: hiring.professional.tradeName,
              }
            : {
                id: hiring.contractor.id,
                name: hiring.contractor.name,
                tradeName: hiring.contractor.tradeName,
              },
      };
    }),
  });
}
