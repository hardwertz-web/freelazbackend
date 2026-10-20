import { Prisma } from "@prisma/client";

/**
 * Handle de banco que serve tanto para o client global quanto para o `tx` de
 * uma transação interativa. Usar este tipo nos services permite que a mesma
 * função rode "solta" ou dentro de um $transaction, sem duplicar lógica —
 * importante para não perder atomicidade entre a mudança de status da
 * contratação e o efeito colateral (abrir/encerrar o chat).
 */
export type Db = Prisma.TransactionClient;
