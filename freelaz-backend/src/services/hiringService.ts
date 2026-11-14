import type { Hiring } from "@prisma/client";
import type { Db } from "../lib/db";
import { netCentsFor, estimateWithdrawalFeeCents, getCommissionBps } from "../lib/commission";
import { chatStatusForHiring, syncChatToHiringStatus } from "./chatService";
import { refreshProfessionalReliability } from "./reliabilityService";

/**
 * Status possíveis de uma contratação (espelha o comentário de `Hiring.status`
 * no schema). O tipo é declarado aqui — e não como enum do Prisma — porque o
 * schema guarda o status como String para permitir a extensão da Fase 4
 * (disputa etc.) sem uma migração destrutiva de enum.
 */
export type HiringStatus =
  | "AGUARDANDO_PAGAMENTO"
  | "RETIDO"
  | "EM_ANDAMENTO"
  | "CONCLUIDO"
  | "LIBERADO"
  | "CANCELADO"
  | "EM_DISPUTA";

/**
 * Transições permitidas. O VLAEG (seção A) é explícito: "mudança de status de
 * uma contratação nunca é uma escrita livre — sempre passa por uma função de
 * serviço que valida a transição". Este mapa É essa validação; nenhuma rota ou
 * service deve escrever `hiring.status` direto.
 *
 *  - AGUARDANDO_PAGAMENTO → RETIDO (pagamento aprovado) ou CANCELADO (recusado)
 *  - RETIDO → EM_ANDAMENTO (turno começou) / CONCLUIDO / CANCELADO / EM_DISPUTA
 *  - EM_ANDAMENTO → CONCLUIDO (código de fechamento) / CANCELADO / EM_DISPUTA
 *  - CONCLUIDO → LIBERADO (repasse feito) / EM_DISPUTA (janela de 2h/avaliação)
 *  - EM_DISPUTA → CONCLUIDO / CANCELADO / LIBERADO (decisão administrativa)
 *  - CANCELADO e LIBERADO são terminais
 */
const ALLOWED_TRANSITIONS: Record<HiringStatus, HiringStatus[]> = {
  AGUARDANDO_PAGAMENTO: ["RETIDO", "CANCELADO"],
  RETIDO: ["EM_ANDAMENTO", "CONCLUIDO", "CANCELADO", "EM_DISPUTA"],
  EM_ANDAMENTO: ["CONCLUIDO", "CANCELADO", "EM_DISPUTA"],
  CONCLUIDO: ["LIBERADO", "EM_DISPUTA"],
  EM_DISPUTA: ["CONCLUIDO", "CANCELADO", "LIBERADO"],
  CANCELADO: [],
  LIBERADO: [],
};

export function canTransitionHiring(from: HiringStatus, to: HiringStatus): boolean {
  if (from === to) return true; // no-op idempotente
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Status que representam dinheiro retido/comprometido em uma contratação viva. */
export const ACTIVE_HIRING_STATUSES: HiringStatus[] = [
  "AGUARDANDO_PAGAMENTO",
  "RETIDO",
  "EM_ANDAMENTO",
  "CONCLUIDO",
  "EM_DISPUTA",
];

/** Uma vaga já tem contratação em andamento? (bloqueia novas candidaturas/seleções) */
export async function hasActiveHiring(db: Db, jobPostingId: string): Promise<boolean> {
  const found = await db.hiring.findFirst({
    where: { jobPostingId, status: { in: ACTIVE_HIRING_STATUSES } },
    select: { id: true },
  });
  return Boolean(found);
}

/**
 * Cria a contratação a partir de uma candidatura SELECIONADO — é o passo que
 * faltava para o fluxo fechar: sem Hiring não existe nada para
 * `/api/payments/create` cobrar.
 *
 * Idempotente por `applicationId` (campo único): a seleção pode ser acionada
 * mais de uma vez (ex.: "Retomar vaga") sem gerar duas cobranças.
 *
 * Valores: bruto = valor acordado (contraproposta aceita) ou o valor da vaga;
 * comissão de 10% vem SEMPRE de `commission.ts`, nunca de um número na rota.
 * O Hiring nasce em AGUARDANDO_PAGAMENTO e com um Chat bloqueado — o webhook
 * de pagamento é quem destrava os dois (ver setHiringStatus).
 */
export async function createHiringForApplication(
  db: Db,
  applicationId: string
): Promise<Hiring> {
  const application = await db.application.findUnique({
    where: { id: applicationId },
    include: { jobPosting: true },
  });
  if (!application) throw new Error("Candidatura não encontrada");
  if (application.status !== "SELECIONADO") {
    throw new Error("Só uma candidatura SELECIONADO pode gerar contratação");
  }

  const existing = await db.hiring.findUnique({ where: { applicationId } });
  if (existing) return existing;

  const grossValueCents = application.agreedValueCents ?? application.jobPosting.valueCents;

  // Fase 5b: comissão vem da configuração editável (mesmo `db` da transação).
  // O valor fica CONGELADO no Hiring logo abaixo — mudanças futuras na config
  // não reescrevem contratações existentes.
  const commissionBps = await getCommissionBps(db);

  // Etapa 7.3d - modelo de taxa (flag off por padrao = historico intocado).
  //  LEGACY: profissional recebe o liquido (bruto - comissao).
  //  NEW:    profissional recebe 100% do bruto; a empresa paga tambem a
  //          comissao (serviceFee) e a taxa de saque estimada. O dinheiro
  //          fica em custodia na conta principal do Freelaz (sem split).
  const taxModel = process.env.TAX_MODEL_NEW === "true" ? "NEW" : "LEGACY";
  let netValueCents: number;
  let serviceFeeCents: number | null = null;
  let estimatedWithdrawalFeeCents: number | null = null;
  let totalChargedCents: number | null = null;

  if (taxModel === "NEW") {
    serviceFeeCents = Math.round((grossValueCents * commissionBps) / 10000);
    estimatedWithdrawalFeeCents = estimateWithdrawalFeeCents(grossValueCents);
    totalChargedCents = grossValueCents + serviceFeeCents + estimatedWithdrawalFeeCents;
    netValueCents = grossValueCents;
    console.log(
      `[hiring] taxModel=NEW gross=${grossValueCents} fee=${serviceFeeCents} withdrawal=${estimatedWithdrawalFeeCents} total=${totalChargedCents}`
    );
  } else {
    netValueCents = netCentsFor(grossValueCents, commissionBps);
  }

  return db.hiring.create({
    data: {
      jobPostingId: application.jobPostingId,
      applicationId: application.id,
      jobTitle: application.jobPosting.title,
      professionalId: application.professionalId,
      contractorId: application.jobPosting.contractorId,
      grossValueCents,
      netValueCents,
      commissionBps,
      taxModel,
      serviceFeeCents,
      estimatedWithdrawalFeeCents,
      totalChargedCents,
      status: "AGUARDANDO_PAGAMENTO",
      // o chat já nasce aqui, bloqueado, para existir um único caminho de
      // abertura (o webhook) — nunca criar chat "por fora"
      chat: { create: { status: chatStatusForHiring("AGUARDANDO_PAGAMENTO") } },
    },
  });
}

/**
 * Trava a linha da contratação (SELECT ... FOR UPDATE) dentro de uma
 * transação. Existe para o webhook de pagamento: sem a trava, dois
 * "pagamento aprovado" simultâneos leem o mesmo estado, ambos validam a
 * transição e ambos gravam RETENCAO — saldo retido inflado (divergência D2
 * do relatório). Com a trava, o segundo webhook espera o primeiro confirmar
 * e enxerga o estado novo — vira no-op.
 */
export async function lockHiringForUpdate(db: Db, hiringId: string): Promise<Hiring | null> {
  const rows = await db.$queryRaw<Hiring[]>`
    SELECT * FROM "Hiring" WHERE id = ${hiringId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Único ponto autorizado a mudar `Hiring.status`. Valida a transição, grava o
 * status e sincroniza o chat (abre no pagamento confirmado, encerra no fim).
 * Reenviar o mesmo status é no-op (idempotência de webhook).
 *
 * Efeito colateral: chegar a um estado terminal (LIBERADO ou CANCELADO)
 * recalcula a confiabilidade do profissional — métrica derivada de eventos,
 * nunca digitada à mão (reliabilityService).
 */
export async function setHiringStatus(
  db: Db,
  hiringId: string,
  next: HiringStatus,
  opts: { providerPaymentId?: string; closeReason?: string } = {}
): Promise<Hiring> {
  const current = await db.hiring.findUnique({ where: { id: hiringId } });
  if (!current) throw new Error("Contratação não encontrada");

  if (!canTransitionHiring(current.status as HiringStatus, next)) {
    throw new Error(`Transição de contratação inválida: ${current.status} → ${next}`);
  }

  if (current.status === next) {
    await syncChatToHiringStatus(db, hiringId, next, opts.closeReason);
    return current;
  }

  const updated = await db.hiring.update({
    where: { id: hiringId },
    data: {
      status: next,
      ...(opts.providerPaymentId ? { providerPaymentId: opts.providerPaymentId } : {}),
      ...(next === "CONCLUIDO" ? { completedAt: new Date() } : {}),
    },
  });

  await syncChatToHiringStatus(db, hiringId, next, opts.closeReason);

  // Confiabilidade: só estados entram na conta (janela das últimas 20
  // finalizadas). O recalculo roda na MESMA transação para o score nunca
  // ficar defasado do evento que o originou.
  if (next === "LIBERADO" || next === "CANCELADO") {
    await refreshProfessionalReliability(db, updated.professionalId);
  }

  return updated;
}
