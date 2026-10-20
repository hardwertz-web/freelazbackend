import { prisma } from "../lib/prisma";
import crypto from "crypto";
import { setHiringStatus } from "./hiringService";
import { notifyAndDispatch } from "./notificationService";

/**
 * Códigos de turno — timing exato definido no CLAUDE.md:
 *  - Código de abertura: gerado 1h antes do início do turno
 *  - Código de fechamento: gerado 1h antes do fim do turno
 *  - Avaliação libera: 2h depois que o código de fechamento é USADO (não
 *    apenas gerado — ver markClosingCodeUsed abaixo)
 *
 * Estas funções são pensadas para serem chamadas por um job agendado
 * (cron/queue) rodando a cada poucos minutos, não por ação do usuário.
 */

function generateCode(): string {
  // código numérico de 6 dígitos
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Proteção contra força bruta no canal da empresa (o prompt exige limite de
 * tentativas + registro de auditoria): 5 tentativas FALHAS por código
 * bloqueiam o canal — o desfecho passa a ser a disputa (disputeService),
 * nunca adivinhar o código. Cada tentativa (certa ou erra) fica registrada
 * em `CodeAttempt` para auditoria.
 */
export const MAX_CODE_ATTEMPTS = 5;

async function assertWithinAttemptLimit(
  hiringId: string,
  kind: "OPENING" | "CLOSING"
) {
  const failed = await prisma.codeAttempt.count({
    where: { hiringId, kind, success: false },
  });
  if (failed >= MAX_CODE_ATTEMPTS) {
    throw new Error(
      `Código de ${kind === "OPENING" ? "abertura" : "fechamento"} bloqueado após ${failed} tentativas erradas — abra uma disputa para resolver esta contratação`
    );
  }
}

async function recordAttempt(
  hiringId: string,
  kind: "OPENING" | "CLOSING",
  success: boolean,
  attemptedById?: string
) {
  await prisma.codeAttempt.create({
    data: { hiringId, kind, success, attemptedById: attemptedById ?? null },
  });
}

/** Roda periodicamente: gera o código de abertura para turnos que começam em ~1h. */
export async function generateOpeningCodesDue() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 55 * 60 * 1000); // 55min
  const windowEnd = new Date(now.getTime() + 65 * 60 * 1000); // 65min

  const hirings = await prisma.hiring.findMany({
    where: {
      status: "RETIDO", // pago e aguardando o início
      openingCode: null,
      jobPosting: { startsAt: { gte: windowStart, lte: windowEnd } },
    },
  });

  for (const hiring of hirings) {
    const code = generateCode();
    await prisma.hiring.update({
      where: { id: hiring.id },
      data: { openingCode: code },
    });
    // Etapa 7: notifica o profissional com o código (in-app + e-mail). Try/catch
    // para que uma falha de notificação NUNCA derrube o job de códigos.
    try {
      await notifyAndDispatch({
        userId: hiring.professionalId,
        type: "OPENING_CODE_GENERATED",
        title: "Seu código de abertura chegou",
        body: `Mostre este código à empresa ao iniciar o turno: ${code}`,
        payload: { hiringId: hiring.id, code, jobTitle: hiring.jobTitle },
        dedupeKey: `opening_code:${hiring.id}`,
      });
    } catch (err) {
      console.warn(
        `[codeService] falha ao notificar abertura (hiring ${hiring.id}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return hirings.length;
}

/**
 * Chamada quando a empresa digita o código de ABERTURA que o profissional
 * mostrou no começo do turno. É o evento CONFIRMADO que tira a contratação de
 * RETIDO e a coloca EM_ANDAMENTO (o turno começou) — fechar a lacuna conhecida
 * "RETIDO → EM_ANDAMENTO não tem gatilho". O status muda pelo caminho
 * validado (`setHiringStatus`), nunca por escrita livre.
 */
export async function markOpeningCodeUsed(
  hiringId: string,
  codeEntered: string,
  attemptedById?: string
) {
  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.status === "EM_ANDAMENTO") return hiring; // já iniciado — idempotente
  // O limite é conferido ANTES de validar o código: depois de 5 erros nem o
  // código certo passa — é isso que fecha a força bruta.
  await assertWithinAttemptLimit(hiringId, "OPENING");

  if (!hiring.openingCode) throw new Error("Código de abertura ainda não foi gerado");
  if (hiring.openingCode !== codeEntered) {
    await recordAttempt(hiringId, "OPENING", false, attemptedById);
    throw new Error("Código incorreto");
  }
  if (hiring.status !== "RETIDO") {
    throw new Error(`Código de abertura só vale com a contratação RETIDO (atual: ${hiring.status})`);
  }
  await recordAttempt(hiringId, "OPENING", true, attemptedById);
  return setHiringStatus(prisma, hiringId, "EM_ANDAMENTO");
}

/** Roda periodicamente: gera o código de fechamento para turnos que terminam em ~1h. */
export async function generateClosingCodesDue() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 55 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 65 * 60 * 1000);

  const hirings = await prisma.hiring.findMany({
    where: {
      status: "EM_ANDAMENTO",
      closingCode: null,
      jobPosting: { endsAt: { gte: windowStart, lte: windowEnd } },
    },
  });

  for (const hiring of hirings) {
    const code = generateCode();
    await prisma.hiring.update({
      where: { id: hiring.id },
      data: { closingCode: code },
    });
    // Etapa 7: notifica o contratante (é ele quem confere o código no fim do
    // turno). Try/catch para não derrubar o job.
    try {
      await notifyAndDispatch({
        userId: hiring.contractorId,
        type: "CLOSING_CODE_GENERATED",
        title: "Código de fechamento disponível",
        body: `Peça o código de fechamento ao profissional e confirme-o no app: ${code}`,
        payload: { hiringId: hiring.id, code, jobTitle: hiring.jobTitle },
        dedupeKey: `closing_code:${hiring.id}`,
      });
    } catch (err) {
      console.warn(
        `[codeService] falha ao notificar fechamento (hiring ${hiring.id}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return hirings.length;
}

/**
 * Chamada quando a empresa digita o código de fechamento informado pelo
 * profissional. Marca o horário de uso — é esse timestamp que dispara a
 * liberação da avaliação 2h depois (ver isEvaluationUnlocked).
 */
export async function markClosingCodeUsed(
  hiringId: string,
  codeEntered: string,
  attemptedById?: string
) {
  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.closingCodeUsedAt) return hiring; // já usado — idempotente
  await assertWithinAttemptLimit(hiringId, "CLOSING");

  if (!hiring.closingCode) throw new Error("Código de fechamento ainda não foi gerado");
  if (hiring.closingCode !== codeEntered) {
    await recordAttempt(hiringId, "CLOSING", false, attemptedById);
    throw new Error("Código incorreto");
  }

  await recordAttempt(hiringId, "CLOSING", true, attemptedById);
  // Conclusão do turno: encerra a contagem e marca CONCLUIDO pelo caminho
  // validado (setHiringStatus grava completedAt). O chat continua ABERTO
  // aqui de propósito — as partes ainda podem se falar durante a janela de
  // avaliação/disputa; ele encerra só no LIBERADO/CANCELADO.
  return prisma.$transaction(async (tx) => {
    const concluded = await setHiringStatus(tx, hiringId, "CONCLUIDO");
    return tx.hiring.update({
      where: { id: hiringId },
      data: { closingCodeUsedAt: concluded.completedAt ?? new Date() },
    });
  });
}

export async function isEvaluationUnlocked(hiringId: string): Promise<boolean> {
  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring?.closingCodeUsedAt) return false;
  const twoHoursAfter = new Date(hiring.closingCodeUsedAt.getTime() + 2 * 60 * 60 * 1000);
  return new Date() >= twoHoursAfter;
}
