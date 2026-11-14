/**
 * Taxas cobradas do profissional (Fase 3).
 *
 * O "Saque instantâneo" tem taxa configurável, lida de `PlatformSetting`
 * (`withdrawal_fee_bps`, em pontos-base: 100 bps = 1%) via
 * `getWithdrawalFeeBps()`. A função de cálculo é PURA: recebe o `feeBps` de
 * quem já resolveu a configuração, o que mantém o cálculo testável e sem
 * esconder I/O dentro de uma conta de dinheiro.
 *
 * `INSTANT_WITHDRAWAL_FEE_BPS` (env) permanece apenas como fallback legado do
 * processo; a rota de saque não o usa mais.
 *
 * Ponto-base em inteiro (e não float) pelo mesmo motivo da comissão: dinheiro
 * em centavos, sem erro de arredondamento de ponto flutuante.
 */
const DEFAULT_INSTANT_WITHDRAWAL_FEE_BPS = 100; // 1% — fallback de fábrica

/** @deprecated Fase 5b: a cobrança usa `getWithdrawalFeeBps()`. Mantido só como fallback. */
export function instantWithdrawalFeeBps(): number {
  const raw = process.env.INSTANT_WITHDRAWAL_FEE_BPS;
  if (raw === undefined || raw === "") return DEFAULT_INSTANT_WITHDRAWAL_FEE_BPS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_INSTANT_WITHDRAWAL_FEE_BPS;
}

/**
 * Taxa, em centavos, do saque instantâneo sobre um valor. Arredonda para BAIXO
 * (o profissional nunca é cobrado um centavo a mais por arredondamento).
 * `feeBps` é obrigatório: a configuração vem de fora (banco), não de uma
 * constante escondida aqui.
 */
export function instantWithdrawalFeeCents(amountCents: number, feeBps: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("amountCents deve ser um inteiro não negativo (centavos)");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0) {
    throw new Error("feeBps deve ser inteiro não negativo");
  }
  return Math.floor((amountCents * feeBps) / 10000);
}
