import type { Payout } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { recordRelease } from "./ledgerService";
import { buildPayoutIdempotencyKey } from "../lib/idempotency";
import { lockHiringForUpdate, setHiringStatus } from "./hiringService";
import { getPixTransferProvider, type PixTransferProvider } from "../lib/pixProvider";
import { hasActiveChargeback } from "./asaasEventService";

/**
 * Repasse do dinheiro retido ao profissional (transferência Pix de saída).
 *
 * Governança Financeira (ver findings.md):
 *  - Só se libera o que está CONCLUIDO — nunca antes.
 *  - GATE DE AVALIAÇÃO (fluxograma X7 → AV1 → FN1): a liberação normal só
 *    acontece 2h depois do uso do código de fechamento — a janela em que a
 *    avaliação mútua é aberta. Duas exceções, ambas ação humana auditada:
 *    decisão de disputa (`skipEvaluationGate`) e payout manual do admin.
 *  - A liberação é idempotente: uma contratação tem no máximo UM Payout
 *    (unique em hiringId). Repetir a chamada com o repasse já CONCLUIDO é
 *    no-op; com o repasse em PROCESSANDO é recusado; com FALHOU é tentado de
 *    novo (é justamente para isso que serve o status FALHOU).
 *  - O lançamento no ledger (LIBERACAO) e a mudança de status para LIBERADO
 *    rodam na MESMA transação do Payout — senão o dinheiro poderia sair sem
 *    ficar registrado, ou o registro existir sem o dinheiro sair.
 *
 * O provedor de transferência é plugável (`PixTransferProvider`): em
 * produção é o Asaas (ver asaas.ts); em desenvolvimento pode ser o sandbox,
 * para validar o fluxo ponta a ponta sem mover dinheiro.
 */

/**
 * Etapa 7.3d - SCAFFOLD (puro, NÃO chamado por nenhum fluxo ainda).
 *
 * Decide de onde o repasse deve sair:
 *  - `SUBACCOUNT` somente com `PAYOUT_FROM_SUBACCOUNT_ENABLED=true` E
 *    `hiring.professional.asaasSubaccountApiKey` preenchida (a chave prova
 *    que a subconta foi criada; a senha/chave nunca é logada);
 *  - caso contrário `MAIN` (comportamento atual, sem mover dinheiro).
 *
 * Não lê banco, não chama provedor e não altera `Payout.origin`: a 7.3d
 * decidirá quando (e se) esse valor será gravado/usado.
 */
// __PAYOUT_ORIGIN_START__
export function resolvePayoutOrigin(hiring: {
  professional?: { asaasSubaccountApiKey?: string | null } | null;
} | null): "MAIN" | "SUBACCOUNT" {
  if (process.env.PAYOUT_FROM_SUBACCOUNT_ENABLED !== "true") return "MAIN";
  const apiKey = hiring?.professional?.asaasSubaccountApiKey;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return "MAIN";
  return "SUBACCOUNT";
}
// __PAYOUT_ORIGIN_END__

export type ReleasePayoutOptions = {
  /** Desconto sobre o líquido (ex.: taxa do saque instantâneo). Default 0. */
  feeCents?: number;
  /**
   * Valor EXATO a transferir (centavos), para o caso de divisão de disputa.
   * Mutuamente exclusivo com `feeCents`; sempre entre 1 e o líquido.
   */
  amountCents?: number;
  /** Rótulo do lançamento de liberação no ledger (rastreabilidade). */
  reason?: string;
  /**
   * Pula o gate de janela de avaliação — SOMENTE decisão humana auditada
   * (resolução de disputa / admin). Nunca usar no caminho normal.
   */
  skipEvaluationGate?: boolean;
  /** Injeção usada em teste; por padrão usa `getPixTransferProvider()`. */
  provider?: PixTransferProvider;
};

/**
 * Erro (ou null) se a liberação normal estiver bloqueada pela janela de
 * avaliação: começa no uso do código de fechamento e dura 2h — é quando as
 * partes podem avaliar antes do dinheiro sair (fluxograma X7/AV1).
 */
export function evaluationGateError(hiring: {
  closingCodeUsedAt: Date | null;
}): string | null {
  if (!hiring.closingCodeUsedAt) {
    return "Conclusão sem código de fechamento — a liberação normal exige a janela de avaliação (decisão de disputa/admin contorna por ação humana auditada)";
  }
  const unlockAt = new Date(hiring.closingCodeUsedAt.getTime() + 2 * 60 * 60 * 1000);
  if (new Date() < unlockAt) {
    return `Avaliação mútua ainda em aberto — liberação disponível a partir de ${unlockAt.toISOString()}`;
  }
  return null;
}

/**
 * GUARDA TRANSACIONAL DE REPASSE (Etapa 3 — crítico).
 *
 * Deve rodar DENTRO da transação de liberação, com a linha da contratação já
 * travada (FOR UPDATE) e o estado RELIDO de dentro da transação. Bloqueia o
 * repasse quando:
 *  - há disputa interna aberta (`disputeOpen`), ou
 *  - há chargeback externo ATIVO e não resolvido, ou
 *  - a contratação não está mais CONCLUIDO.
 *
 * Devolve `null` quando pode liberar; a mensagem do bloqueio caso contrário.
 * NUNCA confiar em verificação pré-transação: esta é a autoridade.
 */
export async function payoutBlockReason(
  db: Parameters<typeof lockHiringForUpdate>[0],
  hiringId: string
): Promise<string | null> {
  // Relê o estado DENTRO da transação (a linha já deve estar travada).
  const hiring = await db.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) return "Contratação não encontrada";
  if (hiring.status !== "CONCLUIDO") {
    return `Liberação bloqueada: contratação não está CONCLUIDA (status atual: ${hiring.status})`;
  }
  if (hiring.disputeOpen) {
    return "Liberação bloqueada: há disputa aberta na contratação";
  }
  if (await hasActiveChargeback(db, hiringId)) {
    return "Liberação bloqueada: há chargeback externo ativo (contestação não resolvida)";
  }
  return null;
}

export async function releasePayout(
  hiringId: string,
  opts: ReleasePayoutOptions = {}
): Promise<Payout> {
  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.status !== "CONCLUIDO") {
    throw new Error(
      `Só é possível liberar pagamento de contratação CONCLUIDA (status atual: ${hiring.status})`
    );
  }
  if (!opts.skipEvaluationGate) {
    const gateError = evaluationGateError(hiring);
    if (gateError) throw new Error(gateError);
  }

  // Guarda PRÉ-transação (fail-fast, barata): evita até chamar o provedor
  // quando já se sabe que há bloqueio. NÃO é a autoridade — a decisão final é
  // relida DENTRO da transação de liberação (abaixo).
  const preBlocked = await payoutBlockReason(prisma, hiring.id);
  if (preBlocked) throw new Error(preBlocked);

  const professional = await prisma.user.findUnique({
    where: { id: hiring.professionalId },
  });
  if (!professional?.pixKey) {
    throw new Error("Profissional não tem chave Pix cadastrada — repasse bloqueado");
  }

  if (opts.feeCents != null && opts.amountCents != null) {
    throw new Error("feeCents e amountCents são mutuamente exclusivos");
  }
  const feeCents = opts.feeCents ?? 0;
  if (!Number.isInteger(feeCents) || feeCents < 0) {
    throw new Error("feeCents deve ser um inteiro não negativo (centavos)");
  }
  // Etapa 7.3d: em NEW o profissional recebe 100% do bruto (as taxas foram
  // pagas pela empresa); em LEGACY recebe o líquido de sempre. O saque manual
  // continua descontando a taxa do próprio profissional (feeCents).
  const payoutBaseCents =
    hiring.taxModel === "NEW" ? hiring.grossValueCents : hiring.netValueCents;
  if (opts.amountCents != null) {
    if (
      !Number.isInteger(opts.amountCents) ||
      opts.amountCents <= 0 ||
      opts.amountCents > payoutBaseCents
    ) {
      throw new Error("amountCents deve ser inteiro entre 1 e o valor líquido (centavos)");
    }
  }
  if (opts.amountCents == null && feeCents >= payoutBaseCents) {
    throw new Error("Taxa de saque maior ou igual ao valor a receber");
  }
  const amountCents = opts.amountCents ?? payoutBaseCents - feeCents;
  if (hiring.taxModel === "NEW") {
    console.log(
      `[payout] taxModel=NEW hiring=${hiring.id} amount=${hiring.grossValueCents} withdrawalFeeReal=${feeCents}`
    );
  }
  const idempotencyKey = buildPayoutIdempotencyKey(hiring.id);
  const reason = opts.reason ?? "payout_completed";

  const existing = await prisma.payout.findUnique({ where: { hiringId: hiring.id } });
  if (existing?.status === "CONCLUIDO") {
    return existing; // já repassado — idempotência
  }
  if (existing?.status === "PROCESSANDO") {
    throw new Error("Este repasse já está em processamento");
  }

  // Registra ANTES de tentar transferir: se o processo morrer no meio, o
  // Payout fica marcado (PROCESSANDO/FALHOU) e a reconciliação enxerga.
  const payout = existing
    ? await prisma.payout.update({
        where: { id: existing.id },
        data: { status: "PROCESSANDO", amountCents, failureReason: null },
      })
    : await prisma.payout.create({
        data: {
          hiringId: hiring.id,
          professionalId: professional.id,
          amountCents,
          idempotencyKey,
          status: "PROCESSANDO",
        },
      });

  const provider = opts.provider ?? getPixTransferProvider();

  try {
    const result = await provider.transfer({
      pixKey: professional.pixKey,
      amountCents,
      idempotencyKey,
      description: `Freelaz — ${hiring.jobTitle}`,
    });

    if (!result.success) {
      return await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: "FALHOU",
          failureReason: result.errorMessage ?? "transferência recusada pelo provedor",
        },
      });
    }

    // COMMIT: a guarda é RELIDA aqui, DENTRO da transação e sob a trava da
    // contratação. Se uma disputa/chargeback foi registrado concorrentemente
    // entre a checagem pré e agora, o bloqueio PREVALECE — nenhum lançamento
    // LIBERACAO é criado e o status NÃO vira LIBERADO. A transferência física
    // já ocorreu, então o Payout fica marcado para conciliação humana (nunca
    // revertemos um payout já concluído automaticamente).
    const committed = await prisma.$transaction(async (tx) => {
      const locked = await lockHiringForUpdate(tx, hiring.id);
      if (!locked) return { blocked: true as const, reason: "Contratação não encontrada" };

      const blockReason = await payoutBlockReason(tx, hiring.id);
      if (blockReason) {
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: "FALHOU",
            failureReason: `bloqueio_concorrente: ${blockReason}`,
          },
        });
        return { blocked: true as const, reason: blockReason };
      }

      const done = await tx.payout.update({
        where: { id: payout.id },
        data: { status: "CONCLUIDO", providerTransferId: result.transferId ?? null },
      });
      // Só o valor EFETIVAMENTE transferido é baixado do saldo retido; a
      // diferença (taxa do saque instantâneo) fica como receita da plataforma.
      await recordRelease(hiring.id, amountCents, reason, "system", tx);
      // LIBERADO é terminal: encerra o chat automaticamente (vira histórico).
      await setHiringStatus(tx, hiring.id, "LIBERADO", {
        closeReason: reason === "saque_instantaneo" ? "saque_instantaneo" : "payout_concluido",
      });
      return { blocked: false as const, payout: done };
    });

    if (committed.blocked) {
      throw new Error(committed.reason);
    }
    return committed.payout;
  } catch (err) {
    // Só marca FALHOU se o commit não o tiver feito (o commit de bloqueio já
    // gravou FALHOU com o motivo). updateMany evita sobrescrever um CONCLUIDO.
    await prisma.payout.updateMany({
      where: { id: payout.id, status: { not: "CONCLUIDO" } },
      data: {
        status: "FALHOU",
        failureReason: err instanceof Error ? err.message : "erro desconhecido",
      },
    });
    throw err;
  }
}

export type BatchPayoutResult = {
  eligible: number;
  released: string[]; // ids das contratações efetivamente repassadas
  failed: { hiringId: string; error: string }[];
};

/**
 * Repasse semanal em lote: pega todas as contratações CONCLUIDAS cuja janela
 * de avaliação (2h após o código de fechamento) já passou e que ainda não
 * foram repassadas (nenhum Payout, ou o último FALHOU) e tenta liberar uma a
 * uma. Uma falha não interrompe as outras — o agendador roda de novo depois e
 * as que sobraram são retentadas. Contratações sem closingCodeUsedAt ficam de
 * fora do lote: conclusão sem código só libera por decisão humana (disputa).
 */
export async function processPendingPayouts(): Promise<BatchPayoutResult> {
  const windowElapsedBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const candidates = await prisma.hiring.findMany({
    where: {
      status: "CONCLUIDO",
      closingCodeUsedAt: { lte: windowElapsedBefore },
      // Bloqueios conhecidos são excluídos da fila: disputa interna aberta ou
      // chargeback externo ativo. A guarda transacional (payoutBlockReason)
      // continua sendo a autoridade — isto é só para não poluir a fila nem
      // marcar FALHOU num caso que não é falha de repasse.
      disputeOpen: false,
      chargebacks: { none: { state: "ATIVO" } },
      OR: [{ payout: null }, { payout: { is: { status: "FALHOU" } } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const released: string[] = [];
  const failed: { hiringId: string; error: string }[] = [];

  for (const { id } of candidates) {
    try {
      await releasePayout(id, { reason: "payout_semanal_lote" });
      released.push(id);
    } catch (err) {
      failed.push({
        hiringId: id,
        error: err instanceof Error ? err.message : "erro desconhecido",
      });
    }
  }

  return { eligible: candidates.length, released, failed };
}

/**
 * Fallback administrativo para o repasse (ex.: conta do Asaas sem saldo ou
 * transferência recusada): o admin faz o Pix pelo app/banco e confirma aqui.
 * Também cria o Payout CONCLUIDO — sem isso a carteira e a reconciliação não
 * enxergariam o dinheiro que saiu. É AÇÃO HUMANA AUDITADA (adminId gravado no
 * ledger) — por isso não passa pelo gate de janela de avaliação.
 */
export async function releasePayoutManually(hiringId: string, adminId: string): Promise<void> {
  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.status !== "CONCLUIDO") {
    throw new Error(`Contratação não está CONCLUIDA (status atual: ${hiring.status})`);
  }

  const existing = await prisma.payout.findUnique({ where: { hiringId } });
  if (existing?.status === "CONCLUIDO") return; // idempotente

  await prisma.$transaction(async (tx) => {
    // Guarda transacional IDÊNTICA ao repasse automático: repasse manual e
    // automático obedecem à mesma proteção (disputa/chargeback ativos). A
    // linha é travada e o estado relido DENTRO da transação.
    const locked = await lockHiringForUpdate(tx, hiringId);
    if (!locked) throw new Error("Contratação não encontrada");
    const blockReason = await payoutBlockReason(tx, hiringId);
    if (blockReason) throw new Error(blockReason);

    if (existing) {
      await tx.payout.update({
        where: { id: existing.id },
        data: {
          status: "CONCLUIDO",
          amountCents: hiring.netValueCents,
          failureReason: null,
        },
      });
    } else {
      await tx.payout.create({
        data: {
          hiringId: hiring.id,
          professionalId: hiring.professionalId,
          amountCents: hiring.netValueCents,
          idempotencyKey: buildPayoutIdempotencyKey(hiring.id),
          status: "CONCLUIDO",
        },
      });
    }
    await recordRelease(hiring.id, hiring.netValueCents, "manual_payout_by_admin", adminId, tx);
    await setHiringStatus(tx, hiring.id, "LIBERADO", { closeReason: "payout_manual" });
  });
}
