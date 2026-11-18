import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { mapNotification } from "@/lib/notificationView";
import { listNotifications } from "@/services/notificationService";

/**
 * GET /api/notifications — lista as notificações do usuário da sessão.
 *
 * Query: `?unreadOnly=1` (opcional) devolve só as não lidas.
 * Resposta: `{ notifications, unreadCount }`.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "1";

  const rawLimit = searchParams.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : NaN;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
    : undefined;

  const result = await listNotifications(auth.user.id, { unreadOnly, limit });
  return NextResponse.json({
    notifications: result.notifications.map(mapNotification),
    unreadCount: result.unreadCount,
  });
}
