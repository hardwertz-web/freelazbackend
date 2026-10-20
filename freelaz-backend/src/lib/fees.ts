/**
 * Taxas cobradas do profissional (Fase 3).
 *
 * O "Saque instantâneo" tem taxa configurável, lida de
 * `INSTANT_WITHDRAWAL_FEE_BPS` (pontos-base: 100 bps = 1%). O valor de fábrica
 * é um PLACEHOLDER — o número exato ainda não foi fechado pelo produto. Para
 * mudar, basta definir a variável de ambiente (ou trocar a constante). A Fase
 * 5 torna isso editável pelo admin nas Configurações Financeiras, junto da
 * comissão e do preço do boost.
 *
 * Ponto-base em inteiro (e não float) pelo mesmo motivo da comissão: dinheiro
 * em centavos, sem erro de arredondamento de ponto flutuante.
 */
const DEFAULT_INSTANT_WITHDRAWAL_FEE_BPS = 100; // 1% — confirmar valor com o produto

export function instantWithdrawalFeeBps(): number {
  const raw = process.env.INSTANT_WITHDRAWAL_FEE_BPS;
  if (raw === undefined || raw === "") return DEFAULT_INSTANT_WITHDRAWAL_FEE_BPS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_INSTANT_WITHDRAWAL_FEE_BPS;
}

/**
 * Taxa, em centavos, do saque instantâneo sobre um valor. Arredonda para BAIXO
 * (o profissional nunca é cobrado um centavo a mais por arredondamento).
 */
export function instantWithdrawalFeeCents(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("amountCents deve ser um inteiro não negativo (centavos)");
  }
  return Math.floor((amountCents * instantWithdrawalFeeBps()) / 10000);
}
