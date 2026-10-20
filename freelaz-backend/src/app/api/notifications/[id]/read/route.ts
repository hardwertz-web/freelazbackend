import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { markRead } from "@/services/notificationService";

/**
 * PATCH /api/notifications/[id]/read — marca UMA notificação como lida.
 * 404 se a notificação não existir ou não pertencer ao usuário da sessão.
 */
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const result = await markRead(auth.user.id, params.id);
  if (!result.found) {
    return NextResponse.json({ error: "Notificação não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ read: true });
}
