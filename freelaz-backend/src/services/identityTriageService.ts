import { prisma } from "@/lib/prisma";
import { extractFields } from "./documentOcrService";
import path from "path";
import fs from "fs";

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function formatDate(d: Date | null): string | null {
  if (!d) return null;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export type TriageResult = {
  decision: "AUTO_OK" | "REVIEW";
  reasons: string[];
  confidence: number;
};

/**
 * Pré-triagem OCR local. NUNCA aprova automaticamente.
 * Só executa se DOCUMENT_AI_ENABLED=true (chamador deve checar flag).
 * Não loga CPF/nome/data completo.
 */
export async function triageDocument(verificationId: string): Promise<TriageResult> {
  const verification = await prisma.identityVerification.findUnique({
    where: { id: verificationId },
    include: { user: true },
  });

  if (!verification) {
    throw new Error("Verificação não encontrada");
  }

  // Tenta obter caminho físico do arquivo
  let imagePath: string | null = null;
  if (verification.documentUrl) {
    // documentUrl é tipo /api/uploads/...
    const rel = verification.documentUrl.replace(/^\/api\/uploads\//, "");
    const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
    imagePath = path.join(uploadRoot, rel);
  }

  if (!imagePath || !fs.existsSync(imagePath)) {
    const reasons = ["missing_field"];
    await prisma.identityVerification.update({
      where: { id: verificationId },
      data: { autoDecision: "REVIEW", reviewReasons: reasons, autoConfidence: 0 },
    });
    console.log("IA cadastro: extraiu 0 de 3 campos, confidence 0");
    return { decision: "REVIEW", reasons, confidence: 0 };
  }

  try {
    const ocr = await extractFields(imagePath);
    const confidence = ocr.confidence || 0;

    const reasons: string[] = [];
    let extractedCount = 0;

    // Verifica campos
    if (ocr.fields.cpf) extractedCount++;
    else reasons.push("missing_field");
    if (ocr.fields.name) extractedCount++;
    else reasons.push("missing_field");
    if (ocr.fields.birthDate) extractedCount++;
    else reasons.push("missing_field");

    console.log(`IA cadastro: extraiu ${extractedCount} de 3 campos, confidence ${Math.round(confidence)}`);

    // Critérios AUTO_OK: TODOS devem bater
    if (confidence < 85) {
      reasons.push("low_confidence");
    }

    // Compara nome (lowercase, sem acento, substring)
    if (ocr.fields.name && verification.user.name) {
      const ocrName = normalizeText(ocr.fields.name);
      const userName = normalizeText(verification.user.name);
      if (!(ocrName.includes(userName) || userName.includes(ocrName))) {
        reasons.push("name_mismatch");
      }
    } else if (ocr.fields.name && !verification.user.name) {
      reasons.push("name_mismatch");
    }

    // Compara CPF (só dígitos)
    if (ocr.fields.cpf && verification.user.document) {
      const ocrCpf = digitsOnly(ocr.fields.cpf);
      const userCpf = digitsOnly(verification.user.document);
      if (ocrCpf !== userCpf) {
        reasons.push("cpf_mismatch");
      }
    } else if (ocr.fields.cpf && !verification.user.document) {
      reasons.push("cpf_mismatch");
    }

    // Compara data (dia/mês/ano)
    if (ocr.fields.birthDate && verification.user.birthDate) {
      const userBirth = formatDate(verification.user.birthDate);
      if (userBirth && ocr.fields.birthDate !== userBirth) {
        reasons.push("birthdate_mismatch");
      }
    } else if (ocr.fields.birthDate && !verification.user.birthDate) {
      reasons.push("birthdate_mismatch");
    }

    // Simplificar lógica
    const nameOk = ocr.fields.name && verification.user.name ? 
      (normalizeText(ocr.fields.name).includes(normalizeText(verification.user.name)) || normalizeText(verification.user.name).includes(normalizeText(ocr.fields.name))) : false;
    const cpfOk = ocr.fields.cpf && verification.user.document ?
      digitsOnly(ocr.fields.cpf) === digitsOnly(verification.user.document) : false;
    const birthOk = ocr.fields.birthDate && verification.user.birthDate ?
      formatDate(verification.user.birthDate) === ocr.fields.birthDate : false;

    if (confidence >= 85 && nameOk && cpfOk && birthOk) {
      await prisma.identityVerification.update({
        where: { id: verificationId },
        data: { autoDecision: "AUTO_OK", reviewReasons: [], autoConfidence: confidence },
      });
      return { decision: "AUTO_OK", reasons: [], confidence };
    } else {
      // Coletar motivos únicos
      const uniqueReasons = Array.from(new Set(reasons));
      if (uniqueReasons.length === 0) {
        if (confidence < 85) uniqueReasons.push("low_confidence");
        if (!nameOk) uniqueReasons.push("name_mismatch");
        if (!cpfOk) uniqueReasons.push("cpf_mismatch");
        if (!birthOk) uniqueReasons.push("birthdate_mismatch");
      }
      await prisma.identityVerification.update({
        where: { id: verificationId },
        data: { autoDecision: "REVIEW", reviewReasons: uniqueReasons, autoConfidence: confidence },
      });
      return { decision: "REVIEW", reasons: uniqueReasons, confidence };
    }
  } catch (err) {
    console.log("IA cadastro: ocr_error, confidence 0");
    await prisma.identityVerification.update({
      where: { id: verificationId },
      data: { autoDecision: "REVIEW", reviewReasons: ["ocr_error"], autoConfidence: 0 },
    });
    return { decision: "REVIEW", reasons: ["ocr_error"], confidence: 0 };
  }
}
