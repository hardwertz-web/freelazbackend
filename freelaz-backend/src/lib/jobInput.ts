/**
 * Validação dos campos de uma vaga — usada tanto pela publicação pública
 * (`POST /api/jobs`) quanto pela edição (`PATCH /api/jobs/[id]`) e pelo
 * convite direto ("Me contrate") da Fase 1. Fica num só lugar para as três
 * rotas rejeitarem exatamente as mesmas entradas.
 */

/**
 * Modalidades aceitas (Fase 2.3c). No banco é `String` de propósito: migrar
 * para enum depois é uma mudança aditiva, sem reescrever o histórico.
 * PRESTADORA é aceita pela API, mas ainda não tem aba visível no MVP.
 */
export const JOB_MODALITIES = ["FREELANCE", "CLT", "PRESTADORA"] as const;

export type JobModality = (typeof JOB_MODALITIES)[number];

/** Modalidade usada quando o cliente não envia nada (schema tem o mesmo default). */
export const DEFAULT_JOB_MODALITY: JobModality = "FREELANCE";

export function isJobModality(value: string): value is JobModality {
  return (JOB_MODALITIES as readonly string[]).includes(value);
}

export type JobFields = {
  title: string;
  description: string;
  category: string;
  city: string | null;
  state: string | null;
  modality: JobModality;
  valueCents: number;
  startsAt: Date;
  endsAt: Date;
};

// Limites apenas para barrar abuso/erro de digitação — não há regra de
// produto definida para tamanho de descrição ou duração do turno.
const MIN_TITLE = 3;
const MAX_TITLE = 120;
const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 4000;
const MAX_CATEGORY = 60;
const MAX_CITY = 80;
const UF_PATTERN = /^[A-Z]{2}$/;
const MAX_SHIFT_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

type ParseOk<T> = { ok: true; data: T };
type ParseErr = { ok: false; error: string };

/**
 * @param partial quando true, campos ausentes são simplesmente ignorados
 *                (usado no PATCH); quando false, todos são obrigatórios.
 *
 * As sobrecargas fazem o TypeScript saber que `partial: false` devolve sempre
 * o conjunto completo de campos — sem precisar de cast na rota de publicação.
 */
export function parseJobFields(
  body: Record<string, unknown>,
  partial: false
): ParseOk<JobFields> | ParseErr;
export function parseJobFields(
  body: Record<string, unknown>,
  partial: true
): ParseOk<Partial<JobFields>> | ParseErr;
export function parseJobFields(
  body: Record<string, unknown>,
  partial: boolean
): ParseOk<Partial<JobFields>> | ParseErr {
  const data: Partial<JobFields> = {};
  const has = (key: string) => body[key] !== undefined;

  if (!partial || has("title")) {
    const title = text(body.title);
    if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
      return { ok: false, error: `Título deve ter entre ${MIN_TITLE} e ${MAX_TITLE} caracteres` };
    }
    data.title = title;
  }

  if (!partial || has("description")) {
    const description = text(body.description);
    if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
      return { ok: false, error: `Descrição deve ter entre ${MIN_DESCRIPTION} e ${MAX_DESCRIPTION} caracteres` };
    }
    data.description = description;
  }

  if (!partial || has("category")) {
    const category = text(body.category).toLowerCase();
    if (!category || category.length > MAX_CATEGORY) {
      return { ok: false, error: "Categoria é obrigatória" };
    }
    data.category = category;
  }

  if (!partial || has("city")) {
    const city = text(body.city);
    if (city.length > MAX_CITY) {
      return { ok: false, error: `Cidade deve ter no máximo ${MAX_CITY} caracteres` };
    }
    // Ausente/vazio → null: vagas antigas continuam caindo no perfil da empresa.
    data.city = city || null;
  }

  if (!partial || has("state")) {
    const state = text(body.state).toUpperCase();
    if (state && !UF_PATTERN.test(state)) {
      return { ok: false, error: "UF deve ter 2 letras (ex: MG)" };
    }
    data.state = state || null;
  }

  if (!partial || has("modality")) {
    const raw = text(body.modality).toUpperCase();
    if (!raw) {
      // Ausente na criação → FREELANCE. No PATCH, campo enviado vazio é erro.
      if (partial) return { ok: false, error: "Modalidade inválida" };
      data.modality = DEFAULT_JOB_MODALITY;
    } else if (isJobModality(raw)) {
      data.modality = raw;
    } else {
      return {
        ok: false,
        error: `Modalidade deve ser uma de: ${JOB_MODALITIES.join(", ")}`,
      };
    }
  }

  if (!partial || has("valueCents")) {
    const valueCents = body.valueCents;
    if (!Number.isInteger(valueCents) || (valueCents as number) <= 0) {
      return { ok: false, error: "valueCents deve ser inteiro positivo (centavos)" };
    }
    data.valueCents = valueCents as number;
  }

  if (!partial || has("startsAt")) {
    const startsAt = parseDate(body.startsAt);
    if (!startsAt) return { ok: false, error: "startsAt inválido (esperado ISO 8601)" };
    data.startsAt = startsAt;
  }

  if (!partial || has("endsAt")) {
    const endsAt = parseDate(body.endsAt);
    if (!endsAt) return { ok: false, error: "endsAt inválido (esperado ISO 8601)" };
    data.endsAt = endsAt;
  }

  // Checagens cruzadas só fazem sentido quando os dois extremos estão no
  // mesmo payload; o PATCH compara com a vaga já salva na rota.
  if (data.startsAt && data.endsAt) {
    const tooLong = data.endsAt.getTime() - data.startsAt.getTime() > MAX_SHIFT_MS;
    if (data.endsAt <= data.startsAt) {
      return { ok: false, error: "O fim do turno deve ser depois do início" };
    }
    if (tooLong) {
      return { ok: false, error: "Turno não pode durar mais de 30 dias" };
    }
  }

  return { ok: true, data };
}
