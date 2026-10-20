import { NextRequest, NextResponse } from "next/server";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { markMessagesRead } from "@/services/chatService";

/**
 * PATCH /api/hirings/[id]/chat/messages/read — marca como lidas as mensagens
 * recebidas (todas as que NÃO foram enviadas pelo usuário da sessão e ainda
 * tinham `readAt` nulo). Só participante da contratação. Resposta: `{ marked }`.
 */
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });

  const result = await markMessagesRead(params.id, access.user.id);
  return NextResponse.json(result);
}
