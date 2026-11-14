import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { sendEmail, type EmailStatus } from "../lib/email";
import {
  closingCodeTemplate,
  counterProposalTemplate,
  openingCodeTemplate,
  proposalTemplate,
  reportReceivedTemplate,
  type EmailContent,
} from "../lib/emailTemplates";

/**
 * Notificações multi-canal — Etapa 7 (Fase B).
 *
 * 4 eventos do MVP (decisão humana), canais ATIVOS: IN_APP + EMAIL.
 * WHATSAPP está MODELADO no enum mas sem provider — o dispatch o marca como
 * SKIPPED (nunca tenta enviar).
 *
 * Nota pós-4b: REPORT_RECEIVED entrou como 5º tipo (backlog). Ele usa o mesmo
 * pipeline; a UI in-app do sino ainda é placeholder, então hoje o canal
 * efetivo para o denunciado é o e-mail.
 *
 * Idempotência: toda emissão traz um `dedupeKey` (@unique em Notification).
 * Reemissão do mesmo evento devolve a notificação existente e **não**
 * redispara os canais — a proteção não depende de a operação nunca duplicar.
 */

/** Canais suportados hoje, em ordem de tentativa. */
const CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.WHATSAPP,
];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

export interface NotifyResult {
  notification: { id: string } & Record<string, unknown>;
  skipped: boolean;
}

/**
 * Cria a notificação. Se `dedupeKey` já existir, devolve a existente com
 * `skipped: true` (não cria e não redispara).
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const { userId, type, title, body } = input;
  const dedupeKey = input.dedupeKey ?? null;

  if (dedupeKey) {
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) return { notification: existing, skipped: true };
  }

  try {
    const created = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        payload: (input.payload ?? undefined) as never,
        dedupeKey,
      },
    });
    return { notification: created, skipped: false };
  } catch (err) {
    // Corrida: duas chamadas concorrentes com o mesmo dedupeKey — a perdedora
    // cai em P2002 e devolve a linha vencedora.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002" && dedupeKey) {
      const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
      if (existing) return { notification: existing, skipped: true };
    }
    throw err;
  }
}

/** Preferência efetiva do canal para um (usuário, tipo): ausência = habilitado. */
async function channelEnabled(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel
): Promise<boolean> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type_channel: { userId, type, channel } },
  });
  return pref ? pref.enabled : true;
}

function emailContentFor(
  type: NotificationType,
  title: string,
  payload: Record<string, unknown> | null
): EmailContent {
  const jobTitle = typeof payload?.jobTitle === "string" ? payload.jobTitle : "Sua contratação";
  const code = typeof payload?.code === "string" ? payload.code : "";
  const valueCents = typeof payload?.valueCents === "number" ? payload.valueCents : undefined;
  const contractorName =
    typeof payload?.contractorName === "string" ? payload.contractorName : undefined;

  switch (type) {
    case NotificationType.OPENING_CODE_GENERATED:
      return openingCodeTemplate({ jobTitle, code });
    case NotificationType.CLOSING_CODE_GENERATED:
      return closingCodeTemplate({ jobTitle, code });
    case NotificationType.PROPOSAL_RECEIVED:
      return proposalTemplate({ jobTitle, contractorName });
    case NotificationType.COUNTER_PROPOSAL_RECEIVED:
      return counterProposalTemplate({ jobTitle, valueCents });
    case NotificationType.REPORT_RECEIVED:
      return reportReceivedTemplate({
        categoryLabel:
          typeof payload?.categoryLabel === "string" ? payload.categoryLabel : "Denúncia",
        hiringTitle: typeof payload?.hiringTitle === "string" ? payload.hiringTitle : null,
      });
    default:
      // Fallback neutro — não deve acontecer com os tipos modelados.
      return { subject: title, html: `<p>${title}</p>`, text: title };
  }
}

/**
 * Dispara a notificação para os canais HABILITADOS. Cria uma
 * `NotificationDelivery` por canal e registra o desfecho:
 *  - IN_APP → SENT (a notificação já está no banco/API);
 *  - EMAIL  → mapa do `sendEmail` (SENT/FAILED/SKIPPED);
 *  - WHATSAPP → sempre SKIPPED, error "channel_not_implemented".
 *
 * Nunca lança por falha de canal — cada canal é isolado.
 */
export async function dispatch(notification: {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: unknown;
}): Promise<void> {
  const { id: notificationId, userId, type, title } = notification;
  const payload =
    notification.payload && typeof notification.payload === "object"
      ? (notification.payload as Record<string, unknown>)
      : null;

  for (const channel of CHANNELS) {
    if (!(await channelEnabled(userId, type, channel))) {
      // Canal desligado por preferência: registra SKIPPED para deixar rastro
      // auditável de que NÃO foi enviado (a notificação em si já existe).
      await upsertDelivery(notificationId, channel, NotificationDeliveryStatus.SKIPPED, {
        error: "disabled_by_preference",
      });
      continue;
    }

    if (channel === NotificationChannel.WHATSAPP) {
      // Modelado, sem provider — registrar como SKIPPED (nunca tenta enviar).
      await upsertDelivery(notificationId, channel, NotificationDeliveryStatus.SKIPPED, {
        error: "channel_not_implemented",
      });
      continue;
    }

    if (channel === NotificationChannel.IN_APP) {
      await upsertDelivery(notificationId, channel, NotificationDeliveryStatus.SENT, {
        sentAt: new Date(),
      });
      continue;
    }

    // EMAIL
    let status: NotificationDeliveryStatus = NotificationDeliveryStatus.SKIPPED;
    let error: string | null = null;
    let sentAt: Date | null = null;
    try {
      const recipientEmail = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!recipientEmail?.email) {
        status = NotificationDeliveryStatus.SKIPPED;
        error = "no_recipient_email";
      } else {
        const content = emailContentFor(type, title, payload);
        const result = await sendEmail({
          to: recipientEmail.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
        status = mapEmailStatus(result.status);
        error = result.error ?? null;
        if (status === NotificationDeliveryStatus.SENT) sentAt = new Date();
      }
    } catch (err) {
      // sendEmail nunca lança, mas por segurança o canal não derruba o resto.
      status = NotificationDeliveryStatus.FAILED;
      error = err instanceof Error ? err.message : String(err);
      console.warn(`[notification] email falhou (notificação ${notificationId})`);
    }
    await upsertDelivery(notificationId, channel, status, { sentAt, error });
  }
}

function mapEmailStatus(status: EmailStatus): NotificationDeliveryStatus {
  switch (status) {
    case "SENT":
      return NotificationDeliveryStatus.SENT;
    case "FAILED":
      return NotificationDeliveryStatus.FAILED;
    default:
      return NotificationDeliveryStatus.SKIPPED;
  }
}

async function upsertDelivery(
  notificationId: string,
  channel: NotificationChannel,
  status: NotificationDeliveryStatus,
  extra: { sentAt?: Date | null; error?: string | null }
): Promise<void> {
  await prisma.notificationDelivery.upsert({
    where: { notificationId_channel: { notificationId, channel } },
    create: {
      notificationId,
      channel,
      status,
      sentAt: extra.sentAt ?? null,
      error: extra.error ?? null,
    },
    update: {
      status,
      sentAt: extra.sentAt ?? null,
      error: extra.error ?? null,
    },
  });
}

/**
 * Wrapper de conveniência: cria (idempotente por dedupeKey) e dispara.
 * Se o `dedupeKey` já existia, **não** redispara.
 */
export async function notifyAndDispatch(input: NotifyInput): Promise<NotifyResult> {
  const result = await notify(input);
  if (!result.skipped) {
    await dispatch(result.notification as never);
  }
  return result;
}

/** Lista as notificações do usuário (mais recentes primeiro). */
export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
) {
  const notifications = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
    include: { deliveries: true },
  });
  const unreadCount = await prisma.notification.count({
    where: { userId, readAt: null },
  });
  return { notifications, unreadCount };
}

/** Marca uma notificação como lida (só se for do usuário). */
export async function markRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.userId !== userId) return { found: false };
  if (!notification.readAt) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }
  return { found: true };
}

/** Marca TODAS as notificações não lidas do usuário como lidas. */
export async function markAllRead(userId: string) {
  const res = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { marked: res.count };
}

/** Preferências explícitas do usuário (linhas existentes). */
export async function getPreferences(userId: string) {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId } });
  return { preferences: prefs };
}

/**
 * Atualiza preferências `{ type, channel, enabled }[]`. Usa upsert por
 * (userId, type, channel) — idempotente.
 */
export async function setPreferences(
  userId: string,
  updates: Array<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }>
) {
  for (const update of updates) {
    await prisma.notificationPreference.upsert({
      where: {
        userId_type_channel: { userId, type: update.type, channel: update.channel },
      },
      create: {
        userId,
        type: update.type,
        channel: update.channel,
        enabled: update.enabled,
      },
      update: { enabled: update.enabled },
    });
  }
  return getPreferences(userId);
}
