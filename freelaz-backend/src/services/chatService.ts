import { ChatStatus } from "@prisma/client";
import type { Db } from "../lib/db";

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
