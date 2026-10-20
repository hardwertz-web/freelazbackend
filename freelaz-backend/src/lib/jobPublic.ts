import { Prisma } from "@prisma/client";

/**
 * Projeção de vaga para o marketplace. Nunca devolver o objeto `JobPosting`
 * cru: ele traz `contractorId`/`targetProfessionalId` e o registro completo do
 * contratante (e-mail, telefone, documento). Aqui só sai o que um card/detalhe
 * público precisa — nome do contratante + selo de verificado.
 */
export const jobCardSelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  valueCents: true,
  status: true,
  visibility: true,
  urgentBoost: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  contractor: {
    select: {
      id: true,
      name: true,
      tradeName: true,
      city: true,
      state: true,
      contractorProfile: { select: { verificationStatus: true } },
    },
  },
} satisfies Prisma.JobPostingSelect;

export type JobCardRow = Prisma.JobPostingGetPayload<{ select: typeof jobCardSelect }>;

export function jobCard(job: JobCardRow) {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    category: job.category,
    valueCents: job.valueCents,
    status: job.status,
    visibility: job.visibility,
    urgentBoost: job.urgentBoost,
    startsAt: job.startsAt,
    endsAt: job.endsAt,
    createdAt: job.createdAt,
    contractor: {
      id: job.contractor.id,
      name: job.contractor.name,
      tradeName: job.contractor.tradeName,
      city: job.contractor.city,
      state: job.contractor.state,
      // selo de verificado do contratante (Fase 1: verificação leve por e-mail)
      verified: job.contractor.contractorProfile?.verificationStatus === "VERIFICADO",
    },
  };
}
