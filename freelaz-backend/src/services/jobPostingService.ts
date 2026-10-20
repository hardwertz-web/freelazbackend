import { prisma } from "../lib/prisma";
import { ApplicationStatus, JobPostingStatus } from "@prisma/client";
import { createHiringForApplication, hasActiveHiring } from "./hiringService";

/**
 * Seleciona um candidato para a vaga: marca a candidatura escolhida como
 * SELECIONADO, todas as outras PENDENTES viram SUPLENTE (nunca rejeitadas
 * em definitivo — ficam disponíveis para "Retomar vaga") e **cria o Hiring**
 * em AGUARDANDO_PAGAMENTO — é o passo que faltava para `/api/payments/create`
 * ter o que cobrar (ver findings.md > lacunas conhecidas).
 *
 * A vaga só vira PREENCHIDA quando o pagamento é confirmado (webhook), por
 * isso aqui NÃO mexemos em `jobPosting.status`. Enquanto o Hiring está em
 * andamento, `hasActiveHiring` impede uma segunda seleção/cobrança em cima da
 * mesma vaga.
 *
 * Idempotente: chamar de novo para a mesma candidatura devolve o Hiring já
 * criado, sem duplicar cobrança.
 */
export async function selectCandidate(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { jobPosting: true },
  });
  if (!application) throw new Error("Candidatura não encontrada");
  if (application.status === ApplicationStatus.DESISTIU) {
    throw new Error("Este profissional desistiu da vaga");
  }
  if (application.jobPosting.status !== JobPostingStatus.ABERTA) {
    throw new Error("Esta vaga não está mais aberta para seleção");
  }

  return prisma.$transaction(async (tx) => {
    // Já existe contratação para esta candidatura? Devolve ela (idempotência).
    const already = await tx.hiring.findUnique({ where: { applicationId } });
    if (already) {
      return tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { hiring: true },
      });
    }

    // Uma vaga não pode ter duas contratações vivas ao mesmo tempo.
    if (await hasActiveHiring(tx, application.jobPostingId)) {
      throw new Error("Esta vaga já tem uma contratação em andamento");
    }

    await tx.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.SELECIONADO },
    });
    await tx.application.updateMany({
      where: {
        jobPostingId: application.jobPostingId,
        id: { not: applicationId },
        status: ApplicationStatus.PENDENTE,
      },
      data: { status: ApplicationStatus.SUPLENTE },
    });

    await createHiringForApplication(tx, applicationId);

    return tx.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { hiring: true },
    });
  });
}

/**
 * Lista os suplentes REALMENTE disponíveis de uma vaga — cruza o dia/horário
 * da vaga com os compromissos já confirmados de cada suplente e remove
 * automaticamente quem já tem outro bico fechado no mesmo período (ver
 * CLAUDE.md > "Checagem de disponibilidade antes de exibir a lista").
 * Nunca retornar alguém que não pode mais aceitar.
 */
export async function listSubstitutes(jobPostingId: string) {
  const jobPosting = await prisma.jobPosting.findUnique({ where: { id: jobPostingId } });
  if (!jobPosting) throw new Error("Vaga não encontrada");

  const candidates = await prisma.application.findMany({
    where: { jobPostingId, status: ApplicationStatus.SUPLENTE },
    include: { professional: true },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) return candidates;

  // Para cada suplente, verifica se ele já tem uma contratação ativa/paga
  // que se sobrepõe ao horário desta vaga (mesmo dia, horário cruzando).
  const professionalIds = candidates.map((c) => c.professionalId);
  const conflictingHirings = await prisma.hiring.findMany({
    where: {
      professionalId: { in: professionalIds },
      status: { in: ["RETIDO", "EM_ANDAMENTO"] }, // contratações já confirmadas/pagas
      jobPosting: {
        // sobreposição de intervalo: começa antes do fim desta vaga E termina depois do início desta vaga
        startsAt: { lt: jobPosting.endsAt },
        endsAt: { gt: jobPosting.startsAt },
      },
    },
    select: { professionalId: true },
  });

  const busyIds = new Set(conflictingHirings.map((h) => h.professionalId));

  return candidates.filter((c) => !busyIds.has(c.professionalId));
}

/**
 * Marca a vaga como ABERTA novamente (usado sempre que uma contratação paga
 * é cancelada antes da conclusão, por qualquer motivo — ver matchService)
 * para que o botão "Retomar vaga" tenha o que mostrar.
 */
export async function reopenJobPosting(jobPostingId: string) {
  return prisma.jobPosting.update({
    where: { id: jobPostingId },
    data: { status: JobPostingStatus.ABERTA },
  });
}
