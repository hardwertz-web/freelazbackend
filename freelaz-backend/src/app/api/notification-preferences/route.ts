import { NextRequest, NextResponse } from "next/server";
import {
  NotificationChannel,
  NotificationType,
} from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getPreferences, setPreferences } from "@/services/notificationService";

/**
 * GET /api/notification-preferences — preferências explícitas do usuário.
 * (Ausência de linha = canal/tipo habilitado; ver notificationService.)
 */
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const result = await getPreferences(auth.user.id);
  return NextResponse.json(result);
}

/**
 * PUT /api/notification-preferences
 * Body: `{ preferences: [{ type, channel, enabled }] }`.
 * Upsert idempotente por (userId, type, channel).
 */
export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body: { preferences?: unknown };
  try {
    body = (await req.json()) as { preferences?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.preferences)) {
    return NextResponse.json({ error: "preferences deve ser uma lista" }, { status: 400 });
  }

  const types = new Set(Object.values(NotificationType));
  const channels = new Set(Object.values(NotificationChannel));
  const updates: Array<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }> = [];

  for (const item of body.preferences) {
    if (!item || typeof item !== "object") {
      return NextResponse.json({ error: "item de preferences inválido" }, { status: 422 });
    }
    const { type, channel, enabled } = item as Record<string, unknown>;
    if (!types.has(type as NotificationType)) {
      return NextResponse.json({ error: `type inválido: ${String(type)}` }, { status: 422 });
    }
    if (!channels.has(channel as NotificationChannel)) {
      return NextResponse.json({ error: `channel inválido: ${String(channel)}` }, { status: 422 });
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled deve ser booleano" }, { status: 422 });
    }
    updates.push({
      type: type as NotificationType,
      channel: channel as NotificationChannel,
      enabled,
    });
  }

  const result = await setPreferences(auth.user.id, updates);
  return NextResponse.json(result);
}
