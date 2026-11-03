import { NextRequest, NextResponse } from "next/server";

// GET: Verificação do webhook pela Meta (roda uma vez quando você salva a URL)
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === expectedToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// POST: Recebe eventos do WhatsApp (mensagens recebidas, status de entrega)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Log estruturado sem PII
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const messages = changes?.messages ?? [];
    const statuses = changes?.statuses ?? [];

    if (messages.length > 0) {
      console.log(`[whatsapp-webhook] recebida ${messages.length} mensagem(ns)`);
    }
    if (statuses.length > 0) {
      console.log(`[whatsapp-webhook] recebido ${statuses.length} status`);
    }

    // Por enquanto só logamos. Implementar respostas automáticas depois.
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[whatsapp-webhook] erro ao processar", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}