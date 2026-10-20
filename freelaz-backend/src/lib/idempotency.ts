import { prisma } from "./prisma";

/**
 * Garante que uma operação financeira (ex: liberar um payout) nunca seja
 * executada duas vezes, mesmo que o webhook do Mercado Pago seja reenviado
 * ou que a função seja chamada em paralelo.
 *
 * Uso: antes de criar um Payout, tente inserir a idempotencyKey. Se já
 * existir (erro de unique constraint), a operação já foi feita — não repita.
 */
export async function isAlreadyProcessed(idempotencyKey: string): Promise<boolean> {
  const existing = await prisma.payout.findUnique({
    where: { idempotencyKey },
  });
  return existing !== null;
}

export function buildPayoutIdempotencyKey(hiringId: string): string {
  return `payout:${hiringId}`;
}
