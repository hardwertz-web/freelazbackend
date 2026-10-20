import { ChatStatus } from "@prisma/client";
import type { Db } from "../lib/db";
import { prisma } from "../lib/prisma";

/**
 * O chat NÃO tem estado próprio independente: ele é sempre um reflexo do
 * estado da contratação. Isso elimina a classe de bug "chat aberto numa
 * contratação cancelada" — basta derivar, nunca sincronizar à mão.
 *
 * Regra (VLAEG > Gatilho):
 *  - pagamento aprovado (RETIDO) libera o chat;
 *  - o chat continua aberto durante o turno, a conclusão e uma disputa
 *    (as partes precisam poder conversar até o dinheiro sair);
 *  - encerra automaticamente quando a contratação chega ao fim
 *    (CANCELADO ou LIBERADO) e vira somente histórico.
 */
export function chatStatusForHiring(hiringStatus: string): ChatStatus {
  switch (hiringStatus) {
    case "RETIDO":
    case "EM_ANDAMENTO":
    case "CONCLUIDO":
    case "EM_DISPUTA":
      return ChatStatus.ABERTO;
    case "CANCELADO":
    case "LIBERADO":
      return ChatStatus.ENCERRADO;
    case "AGUARDANDO_PAGAMENTO":
    default:
      return ChatStatus.AGUARDANDO_PAGAMENTO;
  }
}

/**
 * Aplica ao chat o estado correspondente ao status atual da contratação.
 * Idempotente: chamar duas vezes com o mesmo status não regrava datas nem
 * sobrescreve `openedAt`/`closedAt` já registrados (webhook pode repetir).
 */
export async function syncChatToHiringStatus(
  db: Db,
  hiringId: string,
  hiringStatus: string,
  reason?: string
) {
  const next = chatStatusForHiring(hiringStatus);
  const existing = await db.chat.findUnique({ where: { hiringId } });

  // Contratações antigas (criadas antes da Fase 2) podem não ter chat —
  // criamos sob demanda em vez de quebrar a leitura.
  if (!existing) {
    return db.chat.create({
      data: {
        hiringId,
        status: next,
        openedAt: next === ChatStatus.ABERTO ? new Date() : null,
        closedAt: next === ChatStatus.ENCERRADO ? new Date() : null,
        closeReason: next === ChatStatus.ENCERRADO ? (reason ?? null) : null,
      },
    });
  }

  if (existing.status === next) return existing;

  return db.chat.update({
    where: { id: existing.id },
    data: {
      status: next,
      openedAt:
        next === ChatStatus.ABERTO && !existing.openedAt ? new Date() : existing.openedAt,
      closedAt: next === ChatStatus.ENCERRADO ? new Date() : existing.closedAt,
      closeReason: next === ChatStatus.ENCERRADO ? (reason ?? existing.closeReason) : existing.closeReason,
    },
  });
}

/**
 * Marca como lidas todas as mensagens do chat que NÃO foram enviadas por
 * `userId` e ainda têm `readAt` nulo. Retorna quantas foram marcadas.
 *
 * Etapa 7 (Fase B): resolve a limitação em que `Message.readAt` só era LIDO,
 * nunca escrito. Não notifica o remetente (feature posterior).
 */
export async function markMessagesRead(
  hiringId: string,
  userId: string
): Promise<{ marked: number }> {
  const chat = await prisma.chat.findUnique({ where: { hiringId } });
  if (!chat) return { marked: 0 };

  const res = await prisma.message.updateMany({
    where: { chatId: chat.id, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
  return { marked: res.count };
}

// ==========================================================================
// Soft-hide do chat após a conclusão (Etapa 7 — estilo iFood)
//
// 2h depois de `Hiring.completedAt` (status CONCLUIDO) o chat some da visão
// das PARTES — `Chat.hiddenAt` é preenchido, mas NADA é apagado: `Message` e
// `Chat` continuam no banco e o ADMIN segue enxergando (auditoria).
//
// NUNCA oculta quando há motivo para o histórico continuar visível:
//   (a) `Hiring.disputeOpen = true`;
//   (b) alguma `Dispute` do hiring com status EM_ANALISE;
//   (c) algum `ChargebackEvent` correlacionado com state = "ATIVO".
// Em qualquer dúvida, NÃO oculta (conservador).
// ==========================================================================

/** Janela de soft-hide após a conclusão (2h) — constante, decisão do usuário. */
export const CHAT_HIDE_AFTER_COMPLETION_MS = 2 * 60 * 60 * 1000;

/**
 * Regra de bloqueio do soft-hide: devolve o motivo quando NÃO se deve ocultar
 * (disputa aberta/em análise ou chargeback ativo), senão `null`.
 *
 * Flag pura sobre dados já carregados — a checagem usa `disputeOpen` do hiring,
 * os status de `Dispute` e o `state` de `ChargebackEvent`.
 */
export function chatHideBlocker(input: {
  disputeOpen: boolean;
  disputeStatuses: string[];
  chargebackStates: string[];
}): "dispute" | "chargeback" | null {
  if (input.disputeOpen) return "dispute";
  if (input.disputeStatuses.includes("EM_ANALISE")) return "dispute";
  if (input.chargebackStates.includes("ATIVO")) return "chargeback";
  return null;
}

/**
 * Variante de conveniência que carrega as relações e responde se o chat de um
 * hiring pode ser ocultado. `true` = pode ocultar; `false` = há disputa/
 * chargeback (não ocultar).
 */
export async function canHideChat(hiringId: string): Promise<boolean> {
  const hiring = await prisma.hiring.findUnique({
    where: { id: hiringId },
    select: {
      disputeOpen: true,
      disputes: { select: { status: true } },
      chargebacks: { select: { state: true } },
    },
  });
  if (!hiring) return false;
  const blocker = chatHideBlocker({
    disputeOpen: hiring.disputeOpen,
    disputeStatuses: hiring.disputes.map((d) => d.status),
    chargebackStates: hiring.chargebacks.map((c) => c.state),
  });
  return blocker === null;
}

/**
 * Job: oculta (soft) os chats de contratações CONCLUIDAS há mais de 2h, exceto
 * quando bloqueado por disputa/chargeback. Idempotente: só pega `hiddenAt IS
 * NULL`. NÃO apaga nada. Devolve `{ hidden, skipped }` — `skipped` conta os
 * pulados por motivo (disputa/chargeback), auditável no log do agendador.
 */
export async function hideConcludedChats(): Promise<{
  hidden: number;
  skipped: { dispute: number; chargeback: number };
}> {
  const cutoff = new Date(Date.now() - CHAT_HIDE_AFTER_COMPLETION_MS);

  const candidates = await prisma.chat.findMany({
    where: {
      hiddenAt: null,
      status: ChatStatus.ABERTO,
      hiring: {
        status: "CONCLUIDO",
        completedAt: { not: null, lte: cutoff },
      },
    },
    select: {
      id: true,
      hiring: {
        select: {
          disputeOpen: true,
          disputes: { select: { status: true } },
          chargebacks: { select: { state: true } },
        },
      },
    },
  });

  let hidden = 0;
  const skipped = { dispute: 0, chargeback: 0 };

  for (const chat of candidates) {
    const blocker = chatHideBlocker({
      disputeOpen: chat.hiring.disputeOpen,
      disputeStatuses: chat.hiring.disputes.map((d) => d.status),
      chargebackStates: chat.hiring.chargebacks.map((c) => c.state),
    });
    if (blocker === "dispute") {
      skipped.dispute += 1;
      continue;
    }
    if (blocker === "chargeback") {
      skipped.chargeback += 1;
      continue;
    }
    await prisma.chat.update({ where: { id: chat.id }, data: { hiddenAt: new Date() } });
    hidden += 1;
  }

  return { hidden, skipped };
}

/** Erro HTTP pronto devolvido pelas leituras de chat (404 quando oculto). */
export type ChatAccessError = { status: number; body: { error: string } };

/**
 * Leitura do chat por uma PARTE, já aplicando o soft-hide.
 *
 * Devolve `hidden: true` (com erro 404 pronto) quando `Chat.hiddenAt != null` e
 * o usuário NÃO é ADMIN — a mesma resposta de "não existe", para não revelar
 * que havia uma conversa. Um ADMIN que também seja parte continua vendo.
 *
 * Não refaz a checagem de participante: quem chama (`requireHiringParticipant`)
 * já garantiu isso. Aqui a única pergunta é "está oculto?".
 */
export async function getChatForUser(
  hiringId: string,
  userId: string,
  isAdminUser: boolean
): Promise<
  | { hidden: false }
  | { hidden: true; error: ChatAccessError }
> {
  if (isAdminUser) return { hidden: false };

  const chat = await prisma.chat.findUnique({
    where: { hiringId },
    select: { hiddenAt: true },
  });
  if (chat && chat.hiddenAt) {
    return {
      hidden: true,
      error: { status: 404, body: { error: "Conversa não encontrada" } },
    };
  }
  return { hidden: false };
}

/**
 * Leitura do chat para o ADMIN: NUNCA oculta, mesmo com `hiddenAt` preenchido.
 * É o caminho de auditoria — exige `checkAdminAccess` na rota que chamar.
 */
export async function getChatForAdmin(hiringId: string): Promise<{
  chatId: string | null;
  hiddenAt: Date | null;
}> {
  const chat = await prisma.chat.findUnique({
    where: { hiringId },
    select: { id: true, hiddenAt: true },
  });
  return { chatId: chat?.id ?? null, hiddenAt: chat?.hiddenAt ?? null };
}
