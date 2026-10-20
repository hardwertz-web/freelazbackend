import { prisma } from "../lib/prisma";
import type { Db } from "../lib/db";
import { setHiringStatus, lockHiringForUpdate } from "./hiringService";
import { recordRefund, getRetainedBalance } from "./ledgerService";
import { releasePayout } from "./payoutService";
import { reopenJobPosting } from "./jobPostingService";

/**
 * Disputa — canal de controvérsia com evidências e decisão administrativa
 * (task_plan Fase 4; fluxograma: "cancelamento encaminha casos ambíguos →
 * Disputas e denúncias").
 *
 * Governança: disputa é a ÚNICA via em que dinheiro move por ação humana, e
 * ainda assim só pelo ledger (REEMBOLSO/LIBERACAO) com `decidedById`
 * auditado — nunca escrita direta em saldo. Uma disputa ABERTA vira
 * EM_DISPUTA no Hiring (chat continua aberto); a decisão devolve o Hiring a
 * um estado terminal (CANCELADO) ou o conclui e repassa (LIBERADO).
 *
 * Decisões possíveis (acordadas com o produto):
 *  - DEVOLUCAO_TOTAL: todo saldo retido volta à empresa (REEMBOLSO) e a
 *    vaga reabre para "Retomar vaga" (mesmo caminho do cancelamento);
 *  - LIBERACAO_TOTAL: repasse integral ao profissional (pelo caminho único
 *    `releasePayout`, com o gate de avaliação contornado por ser decisão
 *    humana auditada);
 *  - DIVISAO: `splitPercentToProfessional`% do valor LÍQUIDO ao profissional
 *    (arredondado para baixo), o restante do líquido reembolsado à empresa.
 *    A comissão da plataforma permanece — o serviço teve execução.
 */

const MAX_REASON_LENGTH = 1000;
const MAX_NOTE_LENGTH = 1000;

export async function openDispute(params: {
  hiringId: string;
  openedById: string;
  reason: string;
}) {
  const reason = params.reason.trim();
  if (!reason) throw new Error("reason é obrigatório para abrir uma disputa");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`reason muito longo (máximo ${MAX_REASON_LENGTH} caracteres)`);
  }

  const hiring = await prisma.hiring.findUnique({ where: { id: params.hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  const openedBySide =
    hiring.contractorId === params.openedById
      ? "CONTRACTOR"
      : hiring.professionalId === params.openedById
        ? "PROFESSIONAL"
        : null;
  if (!openedBySide) throw new Error("Você não participa desta contratação");

  // A abertura só faz sentido com dinheiro em jogo/serviço em curso:
  // AGUARDANDO_PAGAMENTO não tem retenção; estados terminais já saíram do fluxo.
  if (hiring.status !== "RETIDO" && hiring.status !== "EM_ANDAMENTO" && hiring.status !== "CONCLUIDO") {
    throw new Error(
      `Disputa disponível com a contratação RETIDO, EM_ANDAMENTO ou CONCLUIDA (atual: ${hiring.status})`
    );
  }

  return prisma.$transaction(async (tx) => {
    // Trava a contratação e RELÊ o estado DENTRO da transação: duas aberturas
    // concorrentes são serializadas aqui — a segunda enxerga a disputa já
    // aberta e é recusada (nada de disputa duplicada).
    const locked = await lockHiringForUpdate(tx, hiring.id);
    if (!locked) throw new Error("Contratação não encontrada");
    if (
      locked.status !== "RETIDO" &&
      locked.status !== "EM_ANDAMENTO" &&
      locked.status !== "CONCLUIDO"
    ) {
      throw new Error(
        `Disputa disponível com a contratação RETIDO, EM_ANDAMENTO ou CONCLUIDA (atual: ${locked.status})`
      );
    }
    const alreadyOpen = await tx.dispute.findFirst({
      where: { hiringId: locked.id, status: "EM_ANALISE" },
      select: { id: true },
    });
    if (alreadyOpen) {
      throw new Error("Já existe uma disputa aberta para esta contratação");
    }

    const dispute = await tx.dispute.create({
      data: {
        hiringId: locked.id,
        openedById: params.openedById,
        openedBySide,
        reason,
      },
    });
    // `disputeOpen` é o flag de leitura rápida já existente no detalhe.
    await tx.hiring.update({
      where: { id: locked.id },
      data: { disputeOpen: true },
    });
    await setHiringStatus(tx, locked.id, "EM_DISPUTA", {
      closeReason: "disputa_aberta",
    });
    return dispute;
  });
}

/** Anexa uma evidência (arquivo já salvo via /api/uploads) a uma disputa aberta. */
export async function addDisputeEvidence(params: {
  disputeId: string;
  uploadedById: string;
  url: string;
  kind?: string | null;
}) {
  const url = params.url.trim();
  if (!url) throw new Error("url é obrigatória");
  // Evidência é arquivo do próprio armazenamento — nunca URL externa
  // (evita vazar IP/log de admin em link forjado e mantém tudo sob LGPD).
  if (/^https?:\/\//i.test(url)) {
    throw new Error("url deve ser um caminho de arquivo interno, não um link externo");
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: params.disputeId } });
  if (!dispute) throw new Error("Disputa não encontrada");
  if (dispute.status !== "EM_ANALISE") {
    throw new Error("Só se adiciona evidência a disputa ainda em análise");
  }

  return prisma.disputeEvidence.create({
    data: {
      disputeId: dispute.id,
      uploadedById: params.uploadedById,
      url,
      kind: params.kind?.trim() || null,
    },
  });
}

export type ResolveDisputeParams = {
  disputeId: string;
  decidedById: string;
  resolution: "DEVOLUCAO_TOTAL" | "LIBERACAO_TOTAL" | "DIVISAO";
  splitPercentToProfessional?: number | null;
  decisionNote: string;
};

export async function resolveDispute(params: ResolveDisputeParams) {
  const decisionNote = params.decisionNote?.trim();
  if (!decisionNote) throw new Error("decisionNote é obrigatória (auditoria da decisão)");
  if (decisionNote.length > MAX_NOTE_LENGTH) {
    throw new Error(`decisionNote muito longa (máximo ${MAX_NOTE_LENGTH} caracteres)`);
  }

  const split = params.splitPercentToProfessional;
  if (params.resolution === "DIVISAO") {
    if (!Number.isInteger(split) || (split as number) < 1 || (split as number) > 99) {
      throw new Error("Em DIVISAO, splitPercentToProfessional deve ser inteiro de 1 a 99");
    }
  }

  const dispute = await prisma.dispute.findUnique({
    where: { id: params.disputeId },
    include: { hiring: true },
  });
  if (!dispute) throw new Error("Disputa não encontrada");
  if (dispute.status !== "EM_ANALISE") {
    throw new Error("Esta disputa já foi resolvida");
  }

  const hiring = dispute.hiring;
  if (hiring.status !== "EM_DISPUTA") {
    throw new Error(
      `Contratação de uma disputa aberta deve estar EM_DISPUTA (atual: ${hiring.status})`
    );
  }

  const retained = await getRetainedBalance(hiring.id);

  if (params.resolution === "DEVOLUCAO_TOTAL") {
    return prisma.$transaction(async (tx) => {
      // Trava + RELÊ dentro da transação: duas resoluções concorrentes são
      // serializadas — a segunda enxerga RESOLVIDA e é recusada.
      const claim = await claimDisputeForResolution(tx, dispute.id);
      if (retained > 0) {
        await recordRefund(
          claim.hiring.id,
          retained,
          "disputa_devolucao_total",
          params.decidedById,
          tx
        );
      }
      await tx.application.update({
        where: { id: claim.hiring.applicationId },
        data: { status: "DESISTIU" },
      });
      await setHiringStatus(tx, claim.hiring.id, "CANCELADO", {
        closeReason: "disputa_devolucao_total",
      });
      const resolved = await markDisputeResolved(tx, dispute.id, {
        ...params,
        split: null,
      });
      // Mesmo caminho do cancelamento: a vaga volta para "Retomar vaga".
      await reopenJobPosting(claim.hiring.jobPostingId);
      // Contrato único de retorno: devolução não gera repasse (payout null).
      return { dispute: resolved, payout: null };
    });
  }

  // LIBERACAO_TOTAL e DIVISAO concluem o serviço e sacam dinheiro — o
  // repasse precisa de chave Pix ANTES da decisão, senão a resolução ficaria
  // "meio tomada" (disputa resolvida, dinheiro parado).
  const professional = await prisma.user.findUnique({
    where: { id: hiring.professionalId },
    select: { pixKey: true },
  });
  if (!professional?.pixKey) {
    throw new Error(
      "Profissional não tem chave Pix cadastrada — cadastre antes de decidir uma liberação"
    );
  }

  const professionalShareCents =
    params.resolution === "LIBERACAO_TOTAL"
      ? hiring.netValueCents
      : Math.floor((hiring.netValueCents * (split as number)) / 100);
  if (professionalShareCents <= 0 || professionalShareCents > hiring.netValueCents) {
    throw new Error("Percentual da divisão resulta em valor inválido ao profissional");
  }
  const contractorRefundCents = hiring.netValueCents - professionalShareCents;

  // Passo 1 (transação): concluir o serviço e decidir a disputa.
  await prisma.$transaction(async (tx) => {
    // Trava + RELÊ dentro da transação (mesma garantia do ramo de devolução).
    const claim = await claimDisputeForResolution(tx, dispute.id);
    // ClosingCodeUsedAt é preenchido se a conclusão veio por aqui — mantém a
    // janela de avaliação coerente para os casos em que o repasse falhar.
    await tx.hiring.update({
      where: { id: claim.hiring.id },
      data: { closingCodeUsedAt: claim.hiring.closingCodeUsedAt ?? new Date() },
    });
    await setHiringStatus(tx, claim.hiring.id, "CONCLUIDO", { closeReason: "disputa_concluida" });
    if (contractorRefundCents > 0) {
      await recordRefund(
        claim.hiring.id,
        contractorRefundCents,
        "disputa_divisao_reembolso",
        params.decidedById,
        tx
      );
    }
    await markDisputeResolved(tx, dispute.id, { ...params, split: split ?? null });
  });

  // Passo 2: repasse da parte do profissional pelo caminho ÚNICO de saída
  // (idempotente, com Payout + ledger + status na mesma transação). O gate
  // de avaliação é contornado porque esta é decisão humana auditada.
  const payout = await releasePayout(hiring.id, {
    amountCents: professionalShareCents,
    reason: params.resolution === "DIVISAO" ? "disputa_divisao" : "disputa_liberacao_total",
    skipEvaluationGate: true,
  });

  const resolved = await prisma.dispute.findUnique({ where: { id: dispute.id } });
  return { dispute: resolved, payout };
}

/**
 * Trava a contratação e RELÊ a disputa DENTRO da transação, garantindo que só
 * UMA resolução prossiga. Duas decisões concorrentes incompatíveis: a segunda
 * enxerga a disputa já RESOLVIDA (ou a contratação fora de EM_DISPUTA) e é
 * recusada — nenhum lançamento duplicado, nenhuma compensação dupla.
 */
async function claimDisputeForResolution(
  tx: Db,
  disputeId: string
): Promise<{
  dispute: { id: string; hiringId: string };
  hiring: {
    id: string;
    applicationId: string;
    jobPostingId: string;
    closingCodeUsedAt: Date | null;
  };
}> {
  const disputeRow = await tx.dispute.findUnique({
    where: { id: disputeId },
    select: { id: true, hiringId: true },
  });
  if (!disputeRow) throw new Error("Disputa não encontrada");

  const locked = await lockHiringForUpdate(tx, disputeRow.hiringId);
  if (!locked) throw new Error("Contratação não encontrada");

  // Releitura DENTRO da transação (a linha está travada): estado da disputa e
  // da contratação são a autoridade.
  const fresh = await tx.dispute.findUnique({
    where: { id: disputeId },
    select: { status: true },
  });
  if (!fresh || fresh.status !== "EM_ANALISE") {
    throw new Error("Esta disputa já foi resolvida");
  }
  if (locked.status !== "EM_DISPUTA") {
    throw new Error(
      `Contratação de uma disputa aberta deve estar EM_DISPUTA (atual: ${locked.status})`
    );
  }
  return {
    dispute: { id: disputeRow.id, hiringId: disputeRow.hiringId },
    hiring: {
      id: locked.id,
      applicationId: locked.applicationId,
      jobPostingId: locked.jobPostingId,
      closingCodeUsedAt: locked.closingCodeUsedAt,
    },
  };
}

async function markDisputeResolved(
  tx: Db,
  disputeId: string,
  params: {
    decidedById: string;
    resolution: string;
    decisionNote: string;
    split: number | null;
  }
) {
  const updated = await tx.dispute.update({
    where: { id: disputeId },
    data: {
      status: "RESOLVIDA",
      resolution: params.resolution as never,
      splitPercentToProfessional: params.split,
      decisionNote: params.decisionNote,
      decidedById: params.decidedById,
      decidedAt: new Date(),
    },
  });
  // Flag de leitura rápida volta a false junto da decisão.
  await tx.hiring.updateMany({
    where: { id: updated.hiringId, disputeOpen: true },
    data: { disputeOpen: false },
  });
  return updated;
}
