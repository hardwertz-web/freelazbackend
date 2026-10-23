import { NextRequest, NextResponse } from "next/server";
import { ApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { publicUser } from "@/lib/publicUser";

/**
 * GET /api/jobs/:id/applications — lista de candidaturas da vaga (só o dono).
 *
 * É o que faltava para a empresa conseguir usar `/jobs/:id/select`: sem essa
 * leitura ela não tinha como descobrir o `applicationId` de cada candidato.
 * `listSubstitutes` (/jobs/:id/resume) já filtra conflito de agenda; aqui é a
 * visão crua de todas as candidaturas, com o status de cada uma.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const job = await prisma.jobPosting.findUnique({
    where: { id: params.id },
    select: { id: true, contractorId: true },
  });
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  if (job.contractorId !== auth.user.id) {
    return NextResponse.json(
      { error: "Apenas a empresa dona da vaga pode ver as candidaturas" },
      { status: 403 }
    );
  }

  const statusParam = (new URL(req.url).searchParams.get("status") ?? "").toUpperCase();
  const status = (Object.values(ApplicationStatus) as string[]).includes(statusParam)
    ? (statusParam as ApplicationStatus)
    : undefined;

  const applications = await prisma.application.findMany({
    where: {
      jobPostingId: job.id,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      professional: {
        select: {
          id: true,
          name: true,
          tradeName: true,
          email: true,
          phone: true,
          documentType: true,
          document: true,
          birthDate: true,
          city: true,
          state: true,
          termsAcceptedAt: true,
          emailConfirmedAt: true,
          professionalProfile: {
            select: {
              headline: true,
              bio: true,
              categories: true,
              region: true,
              availability: true,
              referencePriceCents: true,
              verificationStatus: true,
              ratingAverage: true,
              reliabilityScore: true,
            },
          },
          _count: { select: { portfolioItems: true, workExperiences: true } },
        },
      },
    },
  });

  return NextResponse.json({
    applications: applications.map((application) => ({
      id: application.id,
      status: application.status,
      message: application.message,
      counterOfferValueCents: application.counterOfferValueCents,
      counterOfferBy: application.counterOfferBy,
      agreedValueCents: application.agreedValueCents,
      createdAt: application.createdAt,
      // Para o contratante, o contato do candidato é informação legítima da
      // contratação — diferente do marketplace público, onde nada disso vaza.
      professional: {
        ...publicUser(application.professional),
        professionalProfile: application.professional.professionalProfile,
        portfolioItemsCount: application.professional._count.portfolioItems,
        workExperiencesCount: application.professional._count.workExperiences,
      },
    })),
  });
}
