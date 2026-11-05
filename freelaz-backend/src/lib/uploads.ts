import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { isR2Configured, uploadToR2 } from "./r2Service";

// Onde os arquivos enviados (documento, selfie, currículo, portfólio) ficam
// guardados em dev. Em produção isso deve virar um storage de objeto
// (S3/R2) — enquanto isso, o diretório é ignorado pelo Git.
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Limite de ~2,5 MB em base64 (~1,8 MB reais) — fotos de documento/selfie
// bem abaixo disso; vídeo de portfólio (60s) não passa por aqui em base64,
// será um upload direto quando houver storage definido (Fase 6).
const MAX_DATA_URL_LENGTH = Math.round(2.5 * 1024 * 1024);

export type SavedFile = { url: string; relativePath: string };

/**
 * Salva um arquivo enviado como data URL ("data:image/jpeg;base64,...").
 * Retorna a URL relativa servida por /api/uploads/... ou null se inválido.
 */
export async function saveDataUrlFile(
  dataUrl: string,
  folder: string
): Promise<SavedFile | { error: string }> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return { error: "Arquivo inválido: envie um data URL (data:<mime>;base64,...)" };
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    return { error: "Arquivo muito grande (máximo 2,5 MB)" };
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { error: "Arquivo inválido: corpo base64 malformado" };
  const [, mime, b64] = match;
  const ext = ALLOWED_MIME[mime];
  if (!ext) return { error: `Tipo de arquivo não permitido: ${mime}` };

  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return { error: "Arquivo vazio" };

  const filename = `${randomBytes(12).toString("hex")}.${ext}`;

  if (isR2Configured()) {
    const key = `${folder}/${filename}`;
    const result = await uploadToR2(bytes, key, mime);
    if (!result.ok) {
      return { error: result.error };
    }
    return { url: result.url, relativePath: key };
  }

  // Fallback: disco local (dev sem R2 configurado)
  const relativePath = `${folder}/${filename}`;
  const fullPath = path.join(UPLOAD_ROOT, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
  return { url: `/api/uploads/${relativePath}`, relativePath };
}

export function resolveUploadPath(relativePath: string): string | null {
  // Guarda contra path traversal: só caminhos relativos limpos, dentro da raiz.
  const clean = path.normalize(relativePath).replace(/^([.][.][\\/])+/, "");
  if (path.isAbsolute(clean) || clean.startsWith("..")) return null;
  const full = path.join(UPLOAD_ROOT, clean);
  if (!full.startsWith(UPLOAD_ROOT)) return null;
  return full;
}

export { UPLOAD_ROOT };
