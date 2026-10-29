import Tesseract from "tesseract.js";
import fs from "fs";

export type ExtractedFields = {
  name?: string;
  cpf?: string;
  birthDate?: string;
};

export type OcrResult = {
  text: string;
  fields: ExtractedFields;
  confidence: number;
};

/**
 * Extrai campos básicos de documento de identidade via OCR local (tesseract.js).
 * NÃO integra com IdentityVerification. NÃO loga conteúdo do documento/CPF.
 * Apenas para pré-triagem (humano decide).
 */
export async function extractFields(imagePath: string): Promise<OcrResult> {
  if (!fs.existsSync(imagePath)) {
    throw new Error("Arquivo de imagem não encontrado");
  }

  const { data } = await Tesseract.recognize(imagePath, "por", {
    logger: () => {}, // silencioso
  });

  const text = data.text || "";
  const confidence = typeof data.confidence === "number" ? data.confidence : 0;

  const fields: ExtractedFields = {};

  // CPF: 000.000.000-00 ou 11 dígitos
  const cpfRegex1 = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
  const cpfRegex2 = /\b\d{11}\b/;
  const cpfMatch = text.match(cpfRegex1) || text.match(cpfRegex2);
  if (cpfMatch) {
    fields.cpf = cpfMatch[0];
  }

  // Data de nascimento: DD/MM/AAAA
  const birthDateRegex = /\b\d{2}\/\d{2}\/\d{4}\b/;
  const birthMatch = text.match(birthDateRegex);
  if (birthMatch) {
    fields.birthDate = birthMatch[0];
  }

  // Nome: heurística simples - primeira linha com 2+ palavras alfabéticas, maiúsculas
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Ignora linhas com muitos números (prováveis dados)
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (digitCount > 3) continue;
    // Procura linha com pelo menos 2 palavras todas maiúsculas com letras
    const words = trimmed.split(/\s+/).filter((w) => /[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/.test(w));
    if (words.length >= 2 && trimmed === trimmed.toUpperCase()) {
      fields.name = trimmed;
      break;
    }
  }

  return {
    text,
    fields,
    confidence,
  };
}
