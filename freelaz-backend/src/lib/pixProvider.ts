import { transferPix } from "./asaas";

/**
 * ⚠️ PROVEDOR DE TRANSFERÊNCIA PIX DE SAÍDA ⚠️
 *
 * Desde a migração para o Asaas (decisão humana — ver findings.md), a
 * transferência Pix para chave de terceiro é a API `/transfers`, que é
 * autoatendível em contas padrão — era justamente essa a incerteza que
 * travava o Mercado Pago. A implementação real fica em `src/lib/asaas.ts`.
 *
 * O que ainda precisa ser feito antes de produção:
 *  1. Trocar `ASAAS_API_URL` pela produção (https://api.asaas.com/v3) e
 *     configurar `ASAAS_API_KEY` de produção.
 *  2. Testar UMA transferência real de baixo valor (Pix de R$1) antes de
 *     liberar o lote semanal — validação de conta/saldo/limites do Asaas.
 */

export interface PixTransferProvider {
  transfer(params: {
    pixKey: string;
    amountCents: number;
    idempotencyKey: string;
    description: string;
  }): Promise<{ success: boolean; transferId?: string; errorMessage?: string }>;
}

/**
 * Provedor de transferência REAL: chama a API `/transfers` do Asaas (Pix out
 * para chave de terceiro — API autoatendível em contas padrão, o motivo da
 * migração de provedor). Lança/propaga erro explícito quando a credencial
 * não está configurada — nunca "finge" uma transferência.
 */
export const asaasPixTransferProvider: PixTransferProvider = {
  async transfer({ pixKey, amountCents, idempotencyKey, description }) {
    // O provedor interno usa `amountCents`; o cliente Asaas usa `valueCents` —
    // a conversão acontece só aqui, nunca em outra camada.
    return transferPix({ pixKey, valueCents: amountCents, idempotencyKey, description });
  },
};

/**
 * Provedor de SANDBOX: existe só para validar o fluxo de repasse ponta a ponta
 * em desenvolvimento/teste, onde ainda não há credencial real do Asaas.
 * Ele confirma a transferência sem movimentar dinheiro nenhum. NUNCA é usado
 * em produção (ver `getPixTransferProvider`).
 */
export const sandboxPixTransferProvider: PixTransferProvider = {
  async transfer({ idempotencyKey, amountCents }) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { success: false, errorMessage: "valor de transferência inválido" };
    }
    return { success: true, transferId: `sandbox:${idempotencyKey}` };
  },
};

/**
 * Provedor efetivo. Em produção é SEMPRE o do Asaas (com credencial real).
 * O sandbox só entra fora de produção E com `PAYOUT_SANDBOX=1` no ambiente —
 * assim é impossível liberar dinheiro de brincadeira em produção por causa
 * de um .env mal configurado.
 */
export function getPixTransferProvider(): PixTransferProvider {
  if (process.env.NODE_ENV !== "production" && process.env.PAYOUT_SANDBOX === "1") {
    return sandboxPixTransferProvider;
  }
  return asaasPixTransferProvider;
}
