import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { isAdmin } from "@/lib/auth";
import { getChatForUser, syncChatToHiringStatus } from "@/services/chatService";

const MAX_BODY_LENGTH = 2000;

/**
 * POST /api/hirings/:id/chat/messages — envia uma mensagem.
 *
 * Só é permitido com o chat ABERTO, ou seja, depois que o pagamento foi
 * confirmado (VLAEG > Gatilho: "pagamento aprovado libera o chat") e antes de
 * a contratação terminar. Tentar escrever fora dessas janelas devolve 409 —
 * o app usa o status do chat para esconder o campo de texto.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });
  const { hiring, user } = access;

  // Etapa 7: chat oculto (soft-hide) responde 404 ANTES de qualquer checagem de
  // status — não faz sentido dizer "conversa encerrada" para algo que sumiu.
  const visibility = await getChatForUser(hiring.id, user.id, isAdmin(user));
  if (visibility.hidden) {
    return NextResponse.json(visibility.error.body, { status: visibility.error.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text || text.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Mensagem deve ter entre 1 e ${MAX_BODY_LENGTH} caracteres` },
      { status: 422 }
    );
  }

  // Garante que o chat existe e está sincronizado com o status real da
  // contratação antes de decidir se aceita a mensagem (evita chat "fantasma"
  // aberto se algum status foi mudado fora do fluxo).
  const chat =
    hiring.chat ??
    (await prisma.chat.create({
      data: { hiringId: hiring.id, status: "AGUARDANDO_PAGAMENTO" },
    }));

  if (chat.status !== "ABERTO") {
    return NextResponse.json(
      {
        error:
          chat.status === "AGUARDANDO_PAGAMENTO"
            ? "O chat é liberado depois que o pagamento for confirmado"
            : "Esta conversa foi encerrada",
      },
      { status: 409 }
    );
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { chatId: chat.id, senderId: user.id, body: text },
      include: { sender: { select: { id: true, name: true, tradeName: true } } },
    }),
    prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  // Mantém o chat coerente com o status atual mesmo que a contratação tenha
  // mudado entre a leitura e a escrita.
  await syncChatToHiringStatus(prisma, hiring.id, hiring.status);

  return NextResponse.json(
    {
      message: {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        readAt: message.readAt,
        sender: message.sender,
        mine: true,
      },
    },
    { status: 201 }
  );
}
