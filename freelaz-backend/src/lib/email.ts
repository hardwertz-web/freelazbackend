import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";

/**
 * Transporte de e-mail — Etapa 7 (Fase B).
 *
 * Antes desta etapa NÃO havia transporte algum: os tokens de confirmação de
 * e-mail e de reset de senha saíam apenas no console em dev
 * (`src/app/api/auth/register/route.ts`, `.../password/forgot/route.ts`).
 * Este módulo cria o primeiro transporte real e é usado pelo
 * `notificationService` para o canal EMAIL.
 *
 * Seleção de transporte (em ordem):
 *   1. `NODE_ENV=test` OU `EMAIL_TRANSPORT=json` → `jsonTransport`: NÃO envia,
 *      serializa a mensagem. O JSON é anexado a `EMAIL_CAPTURE_FILE` (se
 *      definido) para os testes inspecionarem. Usado pela bateria local.
 *   2. `SMTP_HOST` definido → transporte SMTP real
 *      (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`).
 *   3. Nada configurado → **SKIPPED** com aviso. Nunca lança.
 *
 * Regra de ouro: **enviar e-mail NUNCA derruba a operação principal**. Qualquer
 * falha vira `{ status: "FAILED" | "SKIPPED", error }` — nunca uma exceção.
 */

export type EmailStatus = "SENT" | "FAILED" | "SKIPPED";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  status: EmailStatus;
  error?: string;
}

const DEFAULT_FROM = "no-reply@freelaz.local";

function fromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

/** Mascara o destinatário para log — nunca imprime o e-mail completo. */
export function maskEmail(to: string): string {
  const at = to.indexOf("@");
  if (at <= 0) return "***";
  const local = to.slice(0, at);
  const domain = to.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

type TransportKind = "json" | "smtp" | "none";

function selectTransport(): TransportKind {
  if (process.env.NODE_ENV === "test" || process.env.EMAIL_TRANSPORT === "json") {
    return "json";
  }
  if (process.env.SMTP_HOST && process.env.SMTP_HOST.trim() !== "") {
    return "smtp";
  }
  return "none";
}

interface JsonCapture {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  at: string;
}

/** Anexa a mensagem capturada ao arquivo de captura (append-only JSONL). */
function captureJson(message: JsonCapture): void {
  const file = process.env.EMAIL_CAPTURE_FILE;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(message)}\n`, "utf8");
  } catch (err) {
    // Nunca falha por causa da captura — só avisa.
    console.warn(
      `[email] não foi possível gravar EMAIL_CAPTURE_FILE: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Envia (ou simula/skipa) um e-mail. Sempre resolve — nunca rejeita.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const kind = selectTransport();

  if (kind === "none") {
    console.warn("[email] SMTP não configurado — e-mail ignorado");
    return { status: "SKIPPED", error: "smtp_not_configured" };
  }

  const from = fromAddress();
  const text = message.text ?? "";
  const logTo = maskEmail(message.to);

  try {
    if (kind === "json") {
      // jsonTransport serializa a mensagem; nada sai pela rede.
      const transport = nodemailer.createTransport({ jsonTransport: true });
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text,
      });
      captureJson({
        to: message.to,
        from,
        subject: message.subject,
        html: message.html,
        text,
        at: new Date().toISOString(),
      });
      console.log(`[email] SENT (json) → ${logTo}`);
      return { status: "SENT" };
    }

    // SMTP real.
    const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
    const secure = process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true";
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.isNaN(port) ? 587 : port,
      secure,
      auth:
        process.env.SMTP_USER || process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER ?? "", pass: process.env.SMTP_PASS ?? "" }
          : undefined,
    });
    await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text,
    });
    console.log(`[email] SENT (smtp) → ${logTo}`);
    return { status: "SENT" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Só o motivo — nunca o conteúdo da mensagem.
    console.warn(`[email] FAILED → ${logTo}: ${error}`);
    return { status: "FAILED", error };
  }
}
