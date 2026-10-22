import { createHash } from "crypto";
import type { Db } from "../lib/db";
import type { AsaasWebhookEvent } from "../lib/asaas";
import { setHiringStatus, lockHiringForUpdate, type HiringStatus } from "./hiringService";

/**
 * Eventos de webhook do Asaas — durabilidade, idempotência e chargeback.
 *
 * PRINCÍPIOS (VLAEG + relatório de pré-implementação do chargeback):
 *  1. PERSISTIR ANTES DE RESPONDER 200. Se a persistência falhar, a rota
 *     devolve 5xx para o Asaas reenviar (entrega "at-least-once" documentada).
 *  2. IDEMPOTÊNCIA por `event.id` (`asaasEventId` único): reenvio idêntico é
 *     no-op seguro — nenhum efeito financeiro é repetido.
 *  3. EVENTOS DESCONHECIDOS são PRESERVADOS (status NAO_TRATADO), sem inventar
 *     efeito.
 *  4. CHARGEBACK não move dinheiro automaticamente: registra o fato externo,
 *     BLOQUEIA repasse enquanto a contestação estiver ativa, vincula/abre a
 *     disputa interna e SINALIZA para análise humana. Nenhum `REEMBOLSO` é
 *     criado no evento inicial (decisão de negócio pendente — ver findings.md).
 *  5. Nenhum dado sensível vai para log/resposta: só o HASH do payload.
 */

/** Eventos oficiais de chargeback confirmados na doc do Asaas (2026-10-20). */
export const CHARGEBACK_EVENTS = [
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
] as const;

export function isChargebackEvent(event: string): boolean {
  return (CHARGEBACK_EVENTS as readonly string[]).includes(event);
}

/**
 * Eventos de pagamento que a plataforma RECONHECE (a doc do Asaas lista
 * dezenas). Um evento fora deste conjunto é DESCONHECIDO: persistimos como
 * `NAO_TRATADO` (auditável) e NUNCA inventamos efeito. Isto não é uma lista
 * de "eventos perigosos" nem de "eventos ignoráveis" — é só a fronteira entre
 * "conheço o nome" e "não conheço".
 */
export const KNOWN_PAYMENT_EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_ANTICIPATED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_REFUND_DENIED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  "PAYMENT_DUNNING_RECEIVED",
  "PAYMENT_DUNNING_REQUESTED",
  "PAYMENT_BANK_SLIP_VIEWED",
  "PAYMENT_CHECKOUT_VIEWED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
] as const;

export function isKnownPaymentEvent(event: string): boolean {
  return (KNOWN_PAYMENT_EVENTS as readonly string[]).includes(event);
}

/**
 * Hash estável do payload sanitizado — NUNCA o corpo cru. Remove o objeto
 * `chargeback` (que pode vir com dados do portador) e qualquer campo `token`,
 * mantendo só chaves de correlação. Serve para auditoria/dedup secundário.
 */
export function hashAsaasPayload(body: AsaasWebhookEvent): string {
  const sanitized = {
    id: body.id ?? null,
    event: body.event ?? null,
    paymentId: body.payment?.id ?? null,
    externalReference: body.payment?.externalReference ?? null,
    status: body.payment?.status ?? null,
    value: body.payment?.value ?? null,
  };
  return createHash("sha256").update(JSON.stringify(sanitized)).digest("hex");
}

export type PersistResult =
  | { duplicate: true; record: { id: string; processingStatus: string } }
  | { duplicate: false; record: { id: string; processingStatus: string } };

/**
 * Grava o evento de forma DURÁVEL e idempotente, ANTES de qualquer efeito.
 *
 * A unicidade de `asaasEventId` é a defesa atômica: duas entregas simultâneas
 * do mesmo evento colidem no índice — a segunda cai em P2002 e é tratada como
 * duplicata (200, não reprocessa). Como a linha vencedora pode ainda não estar
 * visível sob READ COMMITTED, relemos com retry curto e, se mesmo assim ela não
 * aparecer, devolvemos duplicata "pendente" — P2002 NUNCA vira 5xx. Um registro
 * já existente cujo processamento FALHOU pode ser retentado (o caller decide),
 * mas um PROCESSADO/IGNORADO/NAO_TRATADO nunca é reprocessado.
 */
export async function persistAsaasEvent(
  db: Db,
  body: AsaasWebhookEvent
): Promise<PersistResult> {
  const asaasEventId = String(body.id ?? "");
  if (!asaasEventId) {
    // Sem `id` não há como garantir idempotência. NÃO inventamos um id:
    // tratamos como payload inválido (a rota responde 400). Ver contrato.
    throw new Error("evento Asaas sem `id` — idempotência impossível");
  }

  const existing = await db.asaasEvent.findUnique({ where: { asaasEventId } });
  if (existing) {
    return { duplicate: true, record: existing };
  }

  try {
    const created = await db.asaasEvent.create({
      data: {
        asaasEventId,
        event: String(body.event ?? ""),
        paymentId: body.payment?.id ? String(body.payment.id) : null,
        externalReference: body.payment?.externalReference ?? null,
        payloadHash: hashAsaasPayload(body),
        processingStatus: "RECEBIDO",
      },
    });
    return { duplicate: false, record: created };
  } catch (err) {
    // Corrida: outra entrega do MESMO evento venceu o índice único. Como o
    // `create` falhou, a transação interativa fica ABORTADA — qualquer query
    // adicional nela falharia com 25P02. Não relemos nada: o P2002 em
    // `asaasEventId` já PROVA que a linha existe (committed ou em voo), então
    // isto é duplicata idempotente, jamais falha de persistência (nunca 5xx).
    if (isUniqueViolation(err)) {
      return {
        duplicate: true,
        record: { id: "", processingStatus: "RECEBIDO" },
      };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && (err as { code?: string }).code === "P2002"
  );
}

/** Marca o desfecho do processamento de um evento já persistido. */
export async function finalizeAsaasEvent(
  db: Db,
  eventRowId: string,
  outcome: {
    processingStatus: "PROCESSADO" | "IGNORADO" | "NAO_TRATADO" | "FALHA";
    actionTaken?: string | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  await db.asaasEvent.update({
    where: { id: eventRowId },
    data: {
      processingStatus: outcome.processingStatus,
      actionTaken: outcome.actionTaken ?? null,
      errorMessage: outcome.errorMessage ?? null,
      processedAt: new Date(),
    },
  });
}

/**
 * Processa um evento de CHARGEBACK já persistido. Nunca move dinheiro:
 *  - registra/atualiza a representação externa (`ChargebackEvent`);
 *  - vincula à contratação e à disputa interna, quando identificáveis;
 *  - ABRE uma disputa interna bloqueante SÓ SE necessário (e ainda não existir
 *    disputa aberta) — para o repasse ficar protegido mesmo sem intervenção;
 *  - sinaliza para análise administrativa.
 *
 * O tipo de evento NÃO determina o desfecho financeiro. Um valor/status
 * externo desconhecido é preservado; nada é convertido silenciosamente.
 */
export async function handleChargebackEvent(
  tx: Db,
  eventRow: { id: string; asaasEventId: string },
  body: AsaasWebhookEvent
): Promise<{ actionTaken: string; hiringId: string | null }> {
  const event = String(body.event ?? "");
  const paymentId = String(body.payment?.id ?? "");
  // CONTRATO REAL (docs.asaas.com > Webhook para cobranças): o objeto
  // `chargeback` vem DENTRO de `payment`. O `body.chargeback` no topo é
  // compatibilidade LEGADA do projeto (aceito como fallback para payloads já
  // registrados/testes antigos) — nunca preferido sobre o campo documentado.
  const cb = body.payment?.chargeback ?? body.chargeback ?? {};
  const externalStatus = String(cb.status ?? externalStatusForEvent(event));
  const externalReason = cb.reason != null ? String(cb.reason) : null;
  const externalDisputeStatus = cb.disputeStatus != null ? String(cb.disputeStatus) : null;
  const disputedValueCents =
    cb.value != null && Number.isFinite(Number(cb.value))
      ? Math.round(Number(cb.value) * 100)
      : null;
  // Datas REAIS do contrato oficial (docs.asaas.com). Aceita os nomes legados
  // `createdDate`/`updatedDate` como fallback, mas NUNCA inventa data: sem
  // campo no payload, fica null.
  const disputeStartDate = parseDate(
    cb.disputeStartDate ?? cb.createdDate ?? null
  );
  const deadlineToSendDisputeDocuments = parseDate(
    cb.deadlineToSendDisputeDocuments ?? null
  );

  // Identifica a contratação de forma SEGURA: pelo externalReference do
  // pagamento (nunca por suposição). Boost não tem contratação → só registra.
  const reference = body.payment?.externalReference ?? null;
  let hiringId: string | null = null;
  if (reference && !reference.startsWith("boost:")) {
    const hiring = await tx.hiring.findUnique({ where: { id: reference } });
    if (hiring) hiringId = hiring.id;
  } else if (paymentId) {
    const hiring = await tx.hiring.findFirst({ where: { providerPaymentId: paymentId } });
    if (hiring) hiringId = hiring.id;
  }

  // Registro externo ADITIVO (uma linha por evento de chargeback recebido). O
  // histórico é preservado: nunca sobrescrevemos a linha anterior — cada
  // evento cria sua própria representação.
  const record = await tx.chargebackEvent.create({
    data: {
      asaasEventId: eventRow.id,
      providerChargebackId: cb.id != null ? String(cb.id) : null,
      paymentId,
      externalStatus,
      externalReason,
      disputedValueCents,
      providerDisputeStatus: externalDisputeStatus,
      providerDisputeStartDate: disputeStartDate,
      deadlineToSendDisputeDocuments,
      // Legado: preenchido só se o provedor enviar os nomes antigos.
      providerCreatedAt: parseDate(cb.createdDate),
      providerUpdatedAt: parseDate(cb.updatedDate),
      hiringId,
      actionTaken: null,
      state: "ATIVO",
    },
  });

  const actions: string[] = [`chargeback_registrado:${externalStatus}`];

  if (!hiringId) {
    // Pagamento não casou com contratação (boost, órfão ou desconhecido):
    // evento preservado, sem bloqueio de repasse (não há o que bloquear).
    actions.push("sem_contratacao_vinculada");
    return { actionTaken: actions.join(";"), hiringId: null };
  }

  // Trava a contratação: a abertura de disputa/flag rodam na MESMA transação
  // do registro — concorrência com o repasse é serializada pela linha.
  const locked = await lockHiringForUpdate(tx, hiringId);
  if (!locked) {
    actions.push("contratacao_desapareceu");
    return { actionTaken: actions.join(";"), hiringId: null };
  }

  // Vincula à disputa interna aberta, se existir; senão abre UMA (sem
  // duplicar). A abertura da disputa interna é o que BLOQUEIA o repasse de
  // forma durável (disputeOpen + status EM_DISPUTA), sem inventar decisão.
  const openDispute = await tx.dispute.findFirst({
    where: { hiringId, status: "EM_ANALISE" },
    orderBy: { createdAt: "desc" },
  });

  let disputeId: string | null = openDispute?.id ?? null;
  if (openDispute) {
    await tx.chargebackEvent.update({
      where: { id: record.id },
      data: { disputeId: openDispute.id },
    });
    actions.push("vinculado_disputa_existente");
  } else if (isBlockableHiringStatus(locked.status as HiringStatus)) {
    // Só abre disputa se a contratação ainda está no fluxo de dinheiro retido.
    // Estados terminais (LIBERADO/CANCELADO) NÃO são reabertos: para esses,
    // apenas sinalizamos (decisão humana — ver 6.4/D1). Não contornamos a
    // máquina de estados com escrita direta.
    try {
      const dispute = await tx.dispute.create({
        data: {
          hiringId,
          openedById: "system:asaas_chargeback",
          openedBySide: "CONTRACTOR",
          reason:
            `Chargeback externo do provedor (${externalStatus})` +
            (externalReason ? ` — motivo: ${externalReason}` : ""),
        },
      });
      disputeId = dispute.id;
      await tx.chargebackEvent.update({
        where: { id: record.id },
        data: { disputeId: dispute.id },
      });
      await tx.hiring.update({ where: { id: hiringId }, data: { disputeOpen: true } });
      await setHiringStatus(tx, hiringId, "EM_DISPUTA", {
        closeReason: "chargeback_externo",
      });
      actions.push("disputa_interna_aberta+bloqueio");
    } catch (err) {
      // Não conseguir abrir a disputa interna NÃO pode deixar o evento sem
      // registro: falha recuperável (o admin sinaliza no painel). Nunca
      // inventamos efeito financeiro.
      actions.push(
        `falha_abrir_disputa:${err instanceof Error ? err.message.slice(0, 80) : "erro"}`
      );
    }
  } else {
    // Contratação já terminal (LIBERADO/CANCELADO): NÃO revertemos pagamento
    // já liberado nem voltamos estado. Só sinalizamos conciliação humana.
    await tx.hiring.updateMany({
      where: { id: hiringId, disputeOpen: false },
      data: { disputeOpen: true },
    });
    actions.push("contratacao_terminal_sinaliza_conciliacao");
  }

  await tx.chargebackEvent.update({
    where: { id: record.id },
    data: { actionTaken: actions.join(";") },
  });

  return { actionTaken: actions.join(";"), hiringId };
}

function isBlockableHiringStatus(status: HiringStatus): boolean {
  return status === "RETIDO" || status === "EM_ANDAMENTO" || status === "CONCLUIDO" || status === "EM_DISPUTA";
}

function externalStatusForEvent(event: string): string {
  // Tradução MÍNIMA e documentada do nome do evento para o status inicial; o
  // desfecho real NUNCA é deduzido do nome (só registrado como fato recebido).
  //
  // O objeto `chargeback` do payload geralmente JÁ traz `status`; este fallback
  // só é usado quando ele falta. Os valores seguem os enums oficiais
  // (docs.asaas.com > Chargeback): REQUESTED | IN_DISPUTE | DISPUTE_LOST |
  // REVERSED | DONE.
  //
  // ⚠️ P3 (docs.asaas.com > Eventos para cobranças > Fluxo de chargeback):
  // `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` = "Disputa vencida, aguardando
  // repasse da adquirente" — quem VENCEU foi o CLIENTE ASAAS (a plataforma),
  // e o evento SEGUINTE é PAYMENT_CONFIRMED ou PAYMENT_RECEIVED (o valor
  // volta). Por isso NÃO mapeamos este evento para um status fabricado de
  // "perdido": mantemos o nome do evento como fato recebido e deixamos a
  // decisão de desbloquear para um desfecho inequívoco/decisão humana (D6).
  switch (event) {
    case "PAYMENT_CHARGEBACK_REQUESTED":
      return "REQUESTED";
    case "PAYMENT_CHARGEBACK_DISPUTE":
      return "IN_DISPUTE";
    case "PAYMENT_AWAITING_CHARGEBACK_REVERSAL":
      return "AWAITING_CHARGEBACK_REVERSAL";
    default:
      return "DESCONHECIDO";
  }
}

function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Existe contestação ATIVA (não encerrada) para a contratação? É a guarda
 * consultada DENTRO da transação de repasse (ver payoutService). Nunca confia
 * em leitura pré-transação.
 */
export async function hasActiveChargeback(db: Db, hiringId: string): Promise<boolean> {
  const found = await db.chargebackEvent.findFirst({
    where: { hiringId, state: "ATIVO" },
    select: { id: true },
  });
  return Boolean(found);
}

/**
 * Chargebacks externos ATIVOS que hoje BLOQUEIAM repasse (Etapa 3.3 —
 * visibilidade do "D6 pendente"). SOMENTE LEITURA: não muda nada.
 *
 * "Bloqueando repasse" = `ChargebackEvent.state = "ATIVO"` ligado a uma
 * contratação `CONCLUIDO`. É o MESMO critério de `payoutBlockReason` →
 * `hasActiveChargeback` (a guarda transacional continua sendo a autoridade; o
 * que não está `CONCLUIDO` não depende dessa guarda, então não entra).
 *
 * Devolve a lista de CONTRATAÇÕES distintas bloqueadas, com o registro ATIVO
 * mais antigo de cada uma (o que define "bloqueado desde"). Nunca devolve
 * payload sensível.
 */
export type BlockedChargeback = {
  hiringId: string;
  externalStatus: string;
  blockedSince: Date;
};

export async function chargebacksBlockingPayout(db: Db): Promise<BlockedChargeback[]> {
  const active = await db.chargebackEvent.findMany({
    where: { state: "ATIVO", hiringId: { not: null }, hiring: { status: "CONCLUIDO" } },
    orderBy: { receivedAt: "asc" },
    select: { hiringId: true, externalStatus: true, receivedAt: true },
  });

  const byHiring = new Map<string, BlockedChargeback>();
  for (const cb of active) {
    const hiringId = cb.hiringId as string;
    if (!byHiring.has(hiringId)) {
      byHiring.set(hiringId, {
        hiringId,
        externalStatus: cb.externalStatus,
        blockedSince: cb.receivedAt,
      });
    }
  }
  return [...byHiring.values()];
}

/** Idempotência de reprocessamento: o evento já foi concluído antes? */
export async function isAsaasEventProcessed(db: Db, asaasEventId: string): Promise<boolean> {
  const row = await db.asaasEvent.findUnique({ where: { asaasEventId } });
  if (!row) return false;
  return row.processingStatus === "PROCESSADO" || row.processingStatus === "IGNORADO" || row.processingStatus === "NAO_TRATADO";
}

// ==========================================================================
// D6 = A2 — encerramento do chargeback SOMENTE em desfecho VERIFICADO
// (decisão aprovada pelo usuário em 2026-10-20; ver .protocol/decisions/D1-D8.md)
// ==========================================================================

/**
 * Eventos que, SEGUNDO A DOC OFICIAL DO ASAAS, seguem `AWAITING_CHARGEBACK_REVERSAL`
 * quando a disputa é vencida pela plataforma — ou seja, o dinheiro VOLTA:
 * `PAYMENT_CONFIRMED` | `PAYMENT_RECEIVED`.
 *
 * Fonte: https://docs.asaas.com/docs/payment-events (consultada 2026-10-20):
 * "When the dispute is won by the Asaas customer, the event after
 * `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` will be `PAYMENT_CONFIRMED` or
 * `PAYMENT_RECEIVED`, depending on whether the charge has already reached its
 * credit date."
 *
 * ⚠️ `AWAITING_CHARGEBACK_REVERSAL` SOZINHO **não** encerra: ele só diz
 * "aguardando repasse da adquirente" — o desfecho inequívoco é o evento
 * SEGUINTE (P3). Timeout também NÃO encerra (isso seria D6=A3, rejeitado).
 */
export const CHARGEBACK_WON_EVENTS = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
] as const;

export function isChargebackWonEvent(event: string): boolean {
  return (CHARGEBACK_WON_EVENTS as readonly string[]).includes(event);
}

/**
 * Status do PROVEDOR compatíveis com "ganho inequívoco" (conjunto MAIS
 * RESTRITIVO — só o que significa desfecho confirmado):
 *  - `DONE`     = contestação concluída no provedor;
 *  - `REVERSED` = valor revertido de volta à conta (chargeback desfeito);
 *  - `disputeStatus = ACCEPTED` = a disputa enviada foi ACEITA (ganhamos).
 * `IN_DISPUTE`/`REQUESTED` NÃO entram (contestação ainda em andamento).
 * `DISPUTE_LOST` NÃO entra (perda — nunca encerra como "ganho").
 */
export function isVerifiedWonStatus(
  status: string | null | undefined,
  disputeStatus: string | null | undefined
): boolean {
  const s = (status ?? "").toUpperCase();
  const d = (disputeStatus ?? "").toUpperCase();
  return s === "DONE" || s === "REVERSED" || d === "ACCEPTED";
}

export type CloseChargebackResult =
  | { closed: true; chargebackId: string; hiringId: string | null; reason: string }
  | { closed: false; reason: string };

/**
 * D6=A2: encerra (`state` `ATIVO` → `ENCERRADO`) o(s) chargeback(s) ATIVOS do
 * pagamento SOMENTE quando TODAS as condições abaixo são verdadeiras:
 *
 *  (a) o evento é de ganho verificado (`isChargebackWonEvent`) —
 *      `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`;
 *  (b) existe `ChargebackEvent` com `state="ATIVO"` correlacionado ao pagamento
 *      (por `paymentId` OU pelo vínculo via `AsaasEvent`/contratação);
 *  (c) o registro ativo tem status do provedor compatível com ganho
 *      (`isVerifiedWonStatus`) OU o próprio evento de ganho carrega esse status.
 *
 * NUNCA move dinheiro: **não** cria `REEMBOLSO` (D7=A1), **não** reverte
 * `LIBERADO` (D1=A1), **não** toca em `payoutBlockReason` — o desbloqueio é
 * CONSEQUÊNCIA natural da guarda transacional (`hasActiveChargeback` deixa de
 * achar `ATIVO`). Idempotente: reenvio do mesmo evento (ou evento de ganho
 * repetido) é no-op — só há `ATIVO` para encerrar uma vez.
 *
 * Não imprime payload/PII; o `closedReason` é texto curto e genérico.
 */
export async function closeChargebackOnVerifiedOutcome(
  tx: Db,
  event: string,
  paymentId: string,
  body?: AsaasWebhookEvent
): Promise<CloseChargebackResult> {
  if (!isChargebackWonEvent(event)) {
    return { closed: false, reason: "evento_nao_verificado" };
  }

  // Status eventualmente presente no PRÓPRIO corpo do evento de ganho (a doc
  // pode trazer `payment.chargeback`); usado como origem alternativa do
  // critério (c) quando o registro ativo não trouxer status compatível.
  const cb = body?.payment?.chargeback ?? body?.chargeback ?? {};
  const bodyStatus = cb.status != null ? String(cb.status) : null;
  const bodyDisputeStatus = cb.disputeStatus != null ? String(cb.disputeStatus) : null;

  // Correlação por pagamento: TODOS os chargebacks ATIVOS daquele paymentId.
  const actives = await tx.chargebackEvent.findMany({
    where: { paymentId, state: "ATIVO" },
    orderBy: { receivedAt: "desc" },
  });
  if (actives.length === 0) {
    // Caso negativo crítico: evento de ganho SEM chargeback ativo correlacionado
    // (ex.: confirmação normal de um pagamento que nunca teve contestação).
    return { closed: false, reason: "sem_chargeback_ativo_correlacionado" };
  }

  const now = new Date();
  const closedIds: string[] = [];
  let closedHiringId: string | null = null;

  for (const cbRow of actives) {
    const won =
      isVerifiedWonStatus(cbRow.externalStatus, cbRow.providerDisputeStatus) ||
      isVerifiedWonStatus(bodyStatus, bodyDisputeStatus);
    if (!won) {
      // Caso negativo crítico: chargeback ATIVO cujo status NÃO indica ganho
      // (ex.: IN_DISPUTE/REQUESTED) — não encerra.
      continue;
    }
    await tx.chargebackEvent.update({
      where: { id: cbRow.id },
      data: {
        state: "ENCERRADO",
        closedAt: now,
        closedReason: `desfecho_verificado:${event}`,
        actionTaken: `${cbRow.actionTaken ?? ""};encerrado_por_desfecho_verificado`.replace(/^;/, ""),
      },
    });
    closedIds.push(cbRow.id);
    if (cbRow.hiringId) closedHiringId = cbRow.hiringId;
  }

  if (closedIds.length === 0) {
    return { closed: false, reason: "status_sem_desfecho_de_ganho" };
  }

  // ESCOPO DELIBERADAMENTE MÍNIMO (D6=A2): encerramos APENAS o(s) ChargebackEvent.
  //
  // A disputa interna automática (`system:asaas_chargeback`) e o `disputeOpen`
  // NÃO são alterados aqui — de propósito:
  //   - resolvê-la por `resolveDispute` moveria dinheiro (liberação/reembolso),
  //     o que viola D7=A1 (sem REEMBOLSO) e D1=A1 (sem reverter);
  //   - reverter `EM_DISPUTA -> CONCLUIDO` seria uma reversão de estado não
  //     autorizada por D6=A2 (a decisão de destravar a disputa é humana — D5).
  // Com o chargeback fora de `ATIVO`, o bloqueio de REPASSE por chargeback
  // desaparece da guarda transacional (payoutBlockReason -> hasActiveChargeback).
  // A contratação em `EM_DISPUTA` segue exigindo decisão humana de administrador
  // (rota auditada), como manda D5=A1.

  return {
    closed: true,
    chargebackId: closedIds[0],
    hiringId: closedHiringId,
    reason: `desfecho_verificado:${event}:${closedIds.length}`,
  };
}
