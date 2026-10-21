import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";
import { getChatForAdmin } from "@/services/chatService";

const MAX_MESSAGES_PER_PAGE = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const hiring = await prisma.hiring.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!hiring) {
    return NextResponse.json({ error: "Contratação não encontrada" }, { status: 404 });
  }

  const adminView = await getChatForAdmin(hiring.id);

  const chat = await prisma.chat.findUnique({ where: { hiringId: hiring.id } });
  if (!chat) {
    return NextResponse.json({ chatId: null, hiddenAt: adminView.hiddenAt, messages: [] });
  }

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

  const messages = recent.reverse();

  return NextResponse.json({
    chatId: chat.id,
    hiddenAt: adminView.hiddenAt,
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      readAt: message.readAt,
      sender: message.sender,
    })),
  });
}
