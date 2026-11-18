// View model das notificações — puro, sem Prisma e sem server-only.
// O mapper vive AQUI (uma única definição) e é aplicado na rota GET.

export type NotificationType =
  | "OPENING_CODE_GENERATED"
  | "CLOSING_CODE_GENERATED"
  | "PROPOSAL_RECEIVED"
  | "COUNTER_PROPOSAL_RECEIVED"
  | "REPORT_RECEIVED";

export type NotificationRow = {
  id: string;
  type: NotificationType | string; // tolera tipos futuros
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  readAt: string | null; // ISO 8601
  createdAt: string; // ISO 8601
  linkUrl: string | null;
};

export type NotificationsResponse = {
  notifications: NotificationRow[];
  unreadCount: number;
};

/** Destino in-app derivado do payload — nunca de campo novo no schema. */
export function deriveLinkUrl(
  type: string,
  payload: Record<string, unknown> | null
): string | null {
  const hiringId =
    payload && typeof payload.hiringId === "string" && payload.hiringId.length > 0
      ? payload.hiringId
      : null;

  switch (type) {
    case "OPENING_CODE_GENERATED":
    case "CLOSING_CODE_GENERATED":
      return hiringId ? `/mensagens/${encodeURIComponent(hiringId)}` : null;
    case "PROPOSAL_RECEIVED":
    case "COUNTER_PROPOSAL_RECEIVED":
      return "/mensagens";
    case "REPORT_RECEIVED":
      // Defesa: leva ao perfil sem expor a identidade do denunciante.
      return "/perfil";
    default:
      return null;
  }
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Reduz a linha do Prisma ao shape público (8 chaves, sem deliveries). */
export function mapNotification(raw: {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: unknown;
  readAt: Date | string | null;
  createdAt: Date | string;
}): NotificationRow {
  const payload =
    raw.payload != null && typeof raw.payload === "object" && !Array.isArray(raw.payload)
      ? (raw.payload as Record<string, unknown>)
      : null;

  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    body: raw.body,
    payload,
    readAt: toIso(raw.readAt),
    createdAt: toIso(raw.createdAt) ?? "",
    linkUrl: deriveLinkUrl(raw.type, payload),
  };
}
