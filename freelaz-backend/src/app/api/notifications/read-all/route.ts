import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { markAllRead } from "@/services/notificationService";

/**
 * POST /api/notifications/read-all — marca TODAS as notificações não lidas do
 * usuário da sessão como lidas. Resposta: `{ marked }`.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const result = await markAllRead(auth.user.id);
  return NextResponse.json(result);
}
