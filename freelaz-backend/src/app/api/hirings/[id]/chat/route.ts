import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { isAdmin } from "@/lib/auth";
import { getChatForUser } from "@/services/chatService";

const MAX_MESSAGES_PER_PAGE = 200;

/**
 * GET /api/hirings/:id/chat — histórico da conversa (só as duas partes).
 *
 * Paginação por cursor (`before`, uma data ISO): busca as N mensagens MAIS
 * RECENTES anteriores àquele instante e devolve em ordem cronológica. Cursor
 * por data evita o problema de `skip` quando chegam mensagens novas durante a
 * navegação.
 *
 * Enquanto o chat está AGUARDANDO_PAGAMENTO, o histórico vem vazio por
 * definição (não existe conversa antes do pagamento confirmado).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });
  const { hiring } = access;

  // Etapa 7: chat soft-hide. Se o chat foi ocultado (2h após a conclusão), as
  // partes veem 404 — o ADMIN continua vendo (auditoria).
  const visibility = await getChatForUser(
    hiring.id,
    access.user.id,
    isAdmin(access.user)
  );
  if (visibility.hidden) {
    return NextResponse.json(visibility.error.body, { status: visibility.error.status });
  }

  // Contratações antigas podem não ter chat criado; criar sob demanda mantém a
  // leitura estável em vez de devolver 404.
  const chat =
    hiring.chat ??
    (await prisma.chat.create({
      data: { hiringId: hiring.id, status: "AGUARDANDO_PAGAMENTO" },
    }));

  const { searchParams } = new URL(req.url);
  const beforeRaw = searchParams.get("before");
  const limit = Math.min(
    MAX_MESSAGES_PER_PAGE,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50)
  );

  const before = beforeRaw ? new Date(beforeRaw) : null;
  const validBefore = before && !Number.isNaN(before.getTime()) ? before : null;

  const recent = await prisma.message.findMany({
    where: {
      chatId: chat.id,
      ...(validBefore ? { createdAt: { lt: validBefore } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { sender: { select: { id: true, name: true, tradeName: true } } },
  });

  const messages = recent.reverse(); // cronológico para renderizar
  const hasMore = recent.length === limit;

  return NextResponse.json({
    chat: {
      id: chat.id,
      status: chat.status,
      openedAt: chat.openedAt,
      closedAt: chat.closedAt,
      closeReason: chat.closeReason,
    },
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      readAt: message.readAt,
      sender: message.sender,
      mine: message.senderId === access.user.id,
    })),
    hasMore,
    nextBefore: hasMore && messages.length > 0 ? messages[0].createdAt : null,
  });
}
