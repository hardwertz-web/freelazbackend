/**
 * Templates de e-mail — Etapa 7 (Fase B).
 *
 * HTML mínimo + texto plano para os 4 eventos do MVP. **Sem PII extra** além
 * do que já está na notificação (título, corpo, código de turno, nome da vaga,
 * valor proposto). Sem imagens, sem rastreamento, sem links externos.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function wrap(title: string, paragraphs: string[]): EmailContent {
  const text = [title, "", ...paragraphs, "", "— Freelaz"].join("\n");
  const html = [
    `<div style="font-family:sans-serif;line-height:1.5;color:#111">`,
    `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 8px">${escapeHtml(p)}</p>`),
    `<p style="margin:16px 0 0;color:#888;font-size:12px">Freelaz</p>`,
    `</div>`,
  ].join("");
  return { subject: title, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** X1 — código de abertura gerado (destinatário: profissional). */
export function openingCodeTemplate(params: {
  jobTitle: string;
  code: string;
}): EmailContent {
  return wrap("Seu código de abertura", [
    `A contratação "${params.jobTitle}" está chegando.`,
    `Mostre este código para a empresa ao iniciar o turno: ${params.code}`,
  ]);
}

/** X3 — código de fechamento gerado (destinatário: contratante). */
export function closingCodeTemplate(params: {
  jobTitle: string;
  code: string;
}): EmailContent {
  return wrap("Código de fechamento disponível", [
    `O turno da contratação "${params.jobTitle}" está terminando.`,
    `Peça o código de fechamento ao profissional e confirme-o no app: ${params.code}`,
  ]);
}

/** Proposta / convite recebido (destinatário: profissional-alvo). */
export function proposalTemplate(params: {
  jobTitle: string;
  contractorName?: string;
}): EmailContent {
  const de = params.contractorName ? ` de ${params.contractorName}` : "";
  return wrap("Você recebeu uma proposta", [
    `Você recebeu uma proposta${de} para a vaga "${params.jobTitle}".`,
    `Abra o Freelaz para aceitar, recusar ou fazer uma contraproposta.`,
  ]);
}

/** Contraproposta recebida (destinatário: o outro lado). */
export function counterProposalTemplate(params: {
  jobTitle: string;
  valueCents?: number;
}): EmailContent {
  const valor =
    typeof params.valueCents === "number"
      ? ` de R$ ${(params.valueCents / 100).toFixed(2)}`
      : "";
  return wrap("Nova contraproposta", [
    `Você recebeu uma contraproposta${valor} para a vaga "${params.jobTitle}".`,
    `Abra o Freelaz para responder.`,
  ]);
}
