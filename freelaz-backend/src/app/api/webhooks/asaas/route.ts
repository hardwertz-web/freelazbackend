import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getPayment,
  isAuthenticAsaasWebhook,
  type AsaasPayment,
  type AsaasWebhookEvent,
} from "@/lib/asaas";
import { recordRetention, recordRefund, getRetainedBalance } from "@/services/ledgerService";
import { setHiringStatus, lockHiringForUpdate } from "@/services/hiringService";
import {
  persistAsaasEvent,
  finalizeAsaasEvent,
  handleChargebackEvent,
  closeChargebackOnVerifiedOutcome,
  isChargebackEvent,
  isKnownPaymentEvent,
  isAsaasEventProcessed,
} from "@/services/asaasEventService";

/**
 * POST /api/webhooks/asaas
 * O Asaas chama esta rota quando o status de um pagamento muda.
 *
 * SEGURANÇA (Etapa 3 — contrato oficial): o Asaas envia o segredo no cabeçalho
 * `asaas-access-token`. A validação é em tempo constante (isAuthenticAsaasWebhook)
 * e NUNCA é registrada em log. O `token` do CORPO era um desvio do contrato;
 * ele só é aceito em ambiente de TESTE explícito (NODE_ENV=test) — em produção
 * apenas o cabeçalho oficial passa. Quando há `ASAAS_API_KEY`, o pagamento
 * ainda é BUSCADO na API (verificação em profundidade) e o valor é conferido.
 *
 * DURABILIDADE/IDEMPOTÊNCIA (Etapa 3): o evento é PERSISTIDO (AsaasEvent)
 * antes do HTTP 200, com `event.id` único. Reenvio idêntico vira no-op. Se a
 * persistência falhar, respondemos 5xx para o Asaas reenviar (entrega
 * "at-least-once" documentada). A trava de linha (SELECT ... FOR UPDATE)
 * serializa dois envios simultâneos.
 *
 * CHARGEBACK (Etapa 3): os eventos oficiais de contestação são registrados
 * SEM mover dinheiro — bloqueiam repasse, vinculam/abrem a disputa interna e
 * sinalizam para análise humana. Nenhum `REEMBOLSO` automático (decisão de
 * negócio pendente).
 */

const APPROVED_STATUSES = ["CONFIRMED", "RECEIVED"];

/**
 * O fallback por `token` do corpo só é permitido quando o ambiente é
 * explicitamente de teste. Em produção, jamais.
 */
function bodyTokenAllowed(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ASAAS_WEBHOOK_ALLOW_BODY_TOKEN === "1";
}

export async function POST(req: NextRequest) {
  let body: AsaasWebhookEvent;
  try {
    body = (await req.json()) as AsaasWebhookEvent;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const headerToken = req.headers.get("asaas-access-token");
  const authenticated = isAuthenticAsaasWebhook({
    headerToken,
    bodyToken: body.token != null ? String(body.token) : null,
    allowBodyToken: bodyTokenAllowed(),
  });
  if (!authenticated) {
    // Não revelar o motivo real da rejeição na resposta; nunca logar o token.
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }

  const event = String(body.event ?? "");
  const paymentId = String(body.payment?.id ?? "");
  const asaasEventId = String(body.id ?? "");
  if (!event || !paymentId) {
    return NextResponse.json({ error: "event/payment ausentes" }, { status: 400 });
  }

  // Sem `id` do evento não há idempotência possível. O contrato do Asaas
  // sempre manda `id`; exigimos para não duplicar efeitos.
  if (!asaasEventId) {
    return NextResponse.json({ error: "evento sem id de idempotência" }, { status: 400 });
  }

  // 1) Persistência DURÁVEL ANTES de qualquer efeito. Falha aqui → 5xx para o
  //    Asaas reenviar (nunca confirmamos processamento sem registro durável).
  let eventRowId: string;
  try {
    const persisted = await prisma.$transaction((tx) => persistAsaasEvent(tx, body));
    if (persisted.duplicate) {
      // Já recebido antes: reenvio idêntico é NO-OP seguro. Se o registro
      // anterior terminou processado/ignorado/não-tratado, não reprocessa.
      const done = await isAsaasEventProcessed(prisma, asaasEventId);
      return NextResponse.json({ received: true, duplicate: true, reprocessed: !done });
    }
    eventRowId = persisted.record.id;
  } catch (err) {
    console.error("[webhook-asaas] falha ao persistir evento:", err);
    return NextResponse.json({ error: "falha ao registrar evento" }, { status: 503 });
  }

  // 2) Verificação em profundidade do pagamento (quando há credencial).
  let payment: AsaasPayment;
  if (process.env.ASAAS_API_KEY) {
    try {
      payment = await getPayment(paymentId);
    } catch (err) {
      // Rede/API fora do ar: falha RECUPERÁVEL — marca o evento e devolve 5xx
      // para reentrega (nada de efeito foi aplicado ainda).
      console.error("[webhook-asaas] falha ao buscar pagamento na API:", err);
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "FALHA",
        errorMessage: "consulta ao provedor indisponível",
      });
      return NextResponse.json({ error: "não foi possível verificar o pagamento" }, { status: 502 });
    }
  } else {
    payment = {
      id: paymentId,
      status: String(body.payment?.status ?? ""),
      value: Number(body.payment?.value ?? 0),
      externalReference: body.payment?.externalReference ?? null,
      dateCreated: "",
    };
  }

  try {
    const result = await routeEvent(eventRowId, event, payment, paymentId, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    // Erro inesperado (ex.: transação) — falha recuperável, marca e 5xx para
    // reentrega. O evento JÁ está persistido; reprocessamento é seguro.
    console.error("[webhook-asaas] erro ao processar evento:", err);
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "FALHA",
      errorMessage: err instanceof Error ? err.message.slice(0, 200) : "erro desconhecido",
    });
    return NextResponse.json({ error: "falha ao processar evento" }, { status: 500 });
  }
}

/**
 * Direciona o evento já persistido para o handler correto. Cada ramo fecha o
 * AsaasEvent com o desfecho (PROCESSADO / IGNORADO / NAO_TRATADO / FALHA).
 */
async function routeEvent(
  eventRowId: string,
  event: string,
  payment: AsaasPayment,
  paymentId: string,
  body: AsaasWebhookEvent
): Promise<{ status: number; body: Record<string, unknown> }> {
  const reference = payment.externalReference || "";

  // ---- CHARGEBACK (registra/bloqueia/sinaliza; nunca move dinheiro) --------
  if (isChargebackEvent(event)) {
    const outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.asaasEvent.findUnique({ where: { id: eventRowId } });
      if (!row) throw new Error("evento não encontrado na transação");
      return handleChargebackEvent(tx, { id: row.id, asaasEventId: row.asaasEventId }, body);
    });
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "PROCESSADO",
      actionTaken: outcome.actionTaken,
    });
    return {
      status: 200,
      body: { received: true, chargeback: true, hiringId: outcome.hiringId },
    };
  }

  // ---- Impulsionamento ("boost:...") ---------------------------------------
  if (reference.startsWith("boost:")) {
    const jobBoostId = reference.replace("boost:", "");
    const boost = await prisma.jobBoost.findUnique({ where: { id: jobBoostId } });
    if (!boost) {
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "IGNORADO",
        actionTaken: "impulsionamento_nao_encontrado",
      });
      return { status: 404, body: { error: "impulsionamento não encontrado" } };
    }
    if (boost.status === "PAGO") {
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "PROCESSADO",
        actionTaken: "boost_ja_pago",
      });
      return { status: 200, body: { received: true, alreadyProcessed: true } };
    }
    if (APPROVED_STATUSES.includes(payment.status)) {
      await prisma.$transaction([
        prisma.jobBoost.update({
          where: { id: boost.id },
          data: { status: "PAGO", providerPaymentId: paymentId },
        }),
        prisma.jobPosting.update({
          where: { id: boost.jobPostingId },
          data: { urgentBoost: true },
        }),
      ]);
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "PROCESSADO",
        actionTaken: "boost_marcado_pago",
      });
    } else if (payment.status === "DELETED" || payment.status === "REFUNDED") {
      await prisma.jobBoost.update({
        where: { id: boost.id },
        data: { status: "FALHOU", providerPaymentId: paymentId },
      });
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "PROCESSADO",
        actionTaken: "boost_marcado_falhou",
      });
    } else {
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "IGNORADO",
        actionTaken: `boost_status_sem_efeito:${payment.status}`,
      });
    }
    return { status: 200, body: { received: true } };
  }

  // ---- Caso padrão: contratação -------------------------------------------
  const hiringId = reference;
  if (!hiringId) {
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "IGNORADO",
      actionTaken: "external_reference_ausente",
    });
    return { status: 400, body: { error: "external_reference ausente" } };
  }

  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) {
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "IGNORADO",
      actionTaken: "contratacao_nao_encontrada",
    });
    return { status: 404, body: { error: "contratação não encontrada" } };
  }

  const valueCents = Math.round(payment.value * 100);
  if (APPROVED_STATUSES.includes(payment.status) && valueCents !== hiring.grossValueCents) {
    console.error(
      `[webhook-asaas] valor divergente: pagamento ${valueCents} x contratação ${hiring.grossValueCents} (${hiringId})`
    );
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "IGNORADO",
      actionTaken: "valor_divergente",
    });
    return { status: 400, body: { error: "valor do pagamento não confere" } };
  }

  if (APPROVED_STATUSES.includes(payment.status) && hiring.asaasSplitId) {
    // Etapa 7.3c — SÓ rastreamento. O split já foi liquidado na origem
    // (divisão no POST /payments): o webhook NÃO move dinheiro nem cria
    // lançamento. Log sem walletId/PII.
    console.log(`[webhook] split recebido hiring=${hiring.id}`);
  }

  if (APPROVED_STATUSES.includes(payment.status)) {
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await lockHiringForUpdate(tx, hiring.id);
      if (!locked) return { notFound: true as const };
      // D6=A2 (2026-10-20): evento de ganho verificado (`PAYMENT_CONFIRMED`/
      // `PAYMENT_RECEIVED` — ver CHARGEBACK_WON_EVENTS) encerra chargeback ATIVO
      // com status compatível. Roda SEMPRE (não só quando o pagamento é novo):
      // é o caso normal — a contratação já está RETIDO e o evento tardio de
      // ganho é justamente o que destrava. Idempotente (só ATIVO encerra 1x).
      // NUNCA move dinheiro nem toca payoutBlockReason.
      const cbOutcome = await closeChargebackOnVerifiedOutcome(tx, event, paymentId, body);
      if (locked.status !== "AGUARDANDO_PAGAMENTO") {
        return { alreadyProcessed: true as const, cbOutcome };
      }
      await tx.jobPosting.update({
        where: { id: hiring.jobPostingId },
        data: { status: "PREENCHIDA" },
      });
      await setHiringStatus(tx, hiring.id, "RETIDO", { providerPaymentId: paymentId });
      await recordRetention(hiring.id, locked.grossValueCents, tx);
      return { ok: true as const, cbOutcome };
    });

    const cbNote = outcome.cbOutcome?.closed
      ? `;chargeback_encerrado_desfecho_verificado:${outcome.cbOutcome.reason}`
      : "";
    if (outcome.alreadyProcessed) {
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "PROCESSADO",
        actionTaken: `pagamento_ja_confirmado${cbNote}`,
      });
      return { status: 200, body: { received: true, alreadyProcessed: true } };
    }
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "PROCESSADO",
      actionTaken: `pagamento_confirmado_retido${cbNote}`,
    });
    return { status: 200, body: { received: true } };
  }

  if (payment.status === "DELETED") {
    if (hiring.status === "AGUARDANDO_PAGAMENTO") {
      await setHiringStatus(prisma, hiring.id, "CANCELADO", {
        providerPaymentId: paymentId,
        closeReason: "pagamento_excluido",
      });
    }
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "PROCESSADO",
      actionTaken: "pagamento_excluido",
    });
    return { status: 200, body: { received: true } };
  }

  if (payment.status === "REFUNDED") {
    if (hiring.status === "LIBERADO") {
      console.error(
        `[webhook-asaas] estorno de contratação já LIBERADA (${hiringId}) — abrir disputa para ajuste manual`
      );
      await prisma.hiring.update({
        where: { id: hiring.id },
        data: { disputeOpen: true },
      });
      await finalizeAsaasEvent(prisma, eventRowId, {
        processingStatus: "PROCESSADO",
        actionTaken: "estorno_pos_liberacao_manual",
      });
      return { status: 200, body: { received: true, needsManualAdjustment: true } };
    }

    const retained = await getRetainedBalance(hiring.id);
    const refundCents = Math.min(retained, Math.max(valueCents, 0));
    await prisma.$transaction(async (tx) => {
      const locked = await lockHiringForUpdate(tx, hiring.id);
      if (!locked) return;
      if (refundCents > 0) {
        await recordRefund(hiring.id, refundCents, "estorno_externo_provedor", "system", tx);
      }
      if (locked.status === "CONCLUIDO") {
        await setHiringStatus(tx, hiring.id, "EM_DISPUTA", { closeReason: "estorno_detectado" });
      } else if (locked.status !== "EM_DISPUTA") {
        await setHiringStatus(tx, hiring.id, "CANCELADO", {
          providerPaymentId: paymentId,
          closeReason: "estorno_pagamento",
        });
      }
    });
    await finalizeAsaasEvent(prisma, eventRowId, {
      processingStatus: "PROCESSADO",
      actionTaken: "estorno_externo",
    });
    return { status: 200, body: { received: true } };
  }

  // Evento conhecido mas sem efeito de estado: registrado como IGNORADO
  // (auditável) — nunca tratado como "inofensivo" por suposição. Evento cujo
  // NOME não reconhecemos é ainda mais conservador: NAO_TRATADO (preservado
  // para investigação, sem efeito) — a fronteira está em KNOWN_PAYMENT_EVENTS,
  // nunca numa suposição de que "evento novo é inofensivo".
  const knownEvent = isKnownPaymentEvent(event);
  await finalizeAsaasEvent(prisma, eventRowId, {
    processingStatus: knownEvent ? "IGNORADO" : "NAO_TRATADO",
    actionTaken: `${knownEvent ? "sem_efeito" : "evento_desconhecido"}:${event}`,
  });
  return {
    status: 200,
    body: { received: true, ignored: event, known: knownEvent },
  };
}
