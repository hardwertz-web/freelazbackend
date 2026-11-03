// Cliente mínimo para Meta WhatsApp Cloud API
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export async function sendWhatsAppMessage(
  toPhone: string,
  body: string
): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { ok: false, error: "WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurado" };
  }

  const digits = toPhone.replace(/\D/g, "");
  const e164 = digits.startsWith("55") ? digits : `55${digits}`;

  try {
    const res = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: e164,
        type: "text",
        text: { body },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await res.json();
    const messageId = data?.messages?.[0]?.id ?? "unknown";
    return { ok: true, messageId };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export function tplOpeningCode(code: string, jobTitle: string): string {
  return `🎯 Seu turno de "${jobTitle}" começa em 1h.\n\nCódigo de abertura: *${code}*\n\nMostre este código para a empresa quando chegar.`;
}

export function tplClosingCode(code: string, jobTitle: string): string {
  return `🏁 Falta 1h para o fim do turno de "${jobTitle}".\n\nCódigo de fechamento: *${code}*\n\nMostre para a empresa confirmar a conclusão.`;
}

export function tplPaymentConfirmed(jobTitle: string): string {
  return `✅ Pagamento confirmado para "${jobTitle}"!\n\nO chat está liberado no app. Combinem os detalhes por lá.`;
}

export function tplProposalReceived(jobTitle: string, valueFormatted: string): string {
  return `📩 Você recebeu uma proposta para "${jobTitle}" (R$ ${valueFormatted}).\n\nAbra o app para aceitar, recusar ou contrapropor.`;
}