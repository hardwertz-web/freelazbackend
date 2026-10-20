import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
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

  const result = await listNotifications(auth.user.id, { unreadOnly });
  return NextResponse.json(result);
}
