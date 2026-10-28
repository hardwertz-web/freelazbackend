import { ApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Regras de propostas privadas ("Me contrate") — Fase 2.5.
 *
 * Proposta = `Application` criada dentro de uma `JobPosting` PRIVADA. Vaga
 * pública e candidatura normal ficam fora destas regras.
 */

/** Status em que a proposta ainda está viva (aguardando resposta). */
export const ACTIVE_PROPOSAL_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.PENDENTE,
  ApplicationStatus.CONTRAPROPOSTA,
];

export const DAILY_PROPOSAL_LIMIT = 5;
export const PROPOSAL_EXPIRY_DAYS = 7;

/**
 * Anti-spam do "Me contrate": conta as propostas privadas ainda vivas criadas
 * pelo contratante nas últimas 24h. Limite de 5 por janela móvel.
 *
 * A contagem é feita por `JobPosting.contractorId` (nunca por um id vindo do
 * corpo) e só considera PRIVADA — candidaturas a vagas públicas não entram.
 */
export async function countRecentPrivateProposals(
  contractorId: string,
  now: Date = new Date()
): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return prisma.application.count({
    where: {
      createdAt: { gte: since },
      status: { in: ACTIVE_PROPOSAL_STATUSES },
      jobPosting: {
        is: { contractorId, visibility: "PRIVADA" },
      },
    },
  });
}

/**
 * Expira propostas privadas paradas há mais de 7 dias.
 *
 * O enum real de `ApplicationStatus` NÃO tem `EXPIRADA` (PENDENTE,
 * CONTRAPROPOSTA, SELECIONADO, SUPLENTE, DESISTIU) — reusamos `DESISTIU`, que
 * já significa "saiu do processo" e não cria estado novo no schema.
 *
 * Idempotente: o `updateMany` só toca linhas que ainda estão vivas e com
 * `createdAt < cutoff`; rodar de novo no mesmo dia devolve 0.
 */
export async function expireStaleProposals(
  now: Date = new Date()
): Promise<{ expired: number; cutoff: Date }> {
  const cutoff = new Date(
    now.getTime() - PROPOSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  const result = await prisma.application.updateMany({
    where: {
      status: { in: ACTIVE_PROPOSAL_STATUSES },
      createdAt: { lt: cutoff },
      jobPosting: { is: { visibility: "PRIVADA" } },
    },
    data: { status: ApplicationStatus.DESISTIU },
  });

  return { expired: result.count, cutoff };
}
