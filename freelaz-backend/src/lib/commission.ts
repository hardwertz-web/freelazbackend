/**
 * Comissão da plataforma — decisão de produto já fechada (ver findings.md >
 * modelo de negócio): **10% fixo para todos**, sem progressão por duração.
 *
 * Hoje é uma constante porque a tabela de comissão editável pelo admin só
 * chega na Fase 5 ("Configurações financeiras editáveis"). Enquanto isso,
 * TODO valor de comissão gravado no Hiring vem daqui — nunca de um número
 * solto dentro de uma rota.
 *
 * Em pontos-base (bps): 1000 bps = 10%. Usar inteiro evita erro de
 * arredondamento de ponto flutuante em dinheiro.
 */
export const PLATFORM_COMMISSION_BPS = 1000;

/**
 * Valor líquido do profissional a partir do valor bruto (centavos).
 * Arredonda a comissão para BAIXO (Math.floor) e o líquido fica com a sobra:
 * o profissional nunca recebe menos do que a conta "redonda" sugere por
 * causa de um centavo de arredondamento a favor da plataforma.
 */
export function netCentsFor(grossValueCents: number, commissionBps = PLATFORM_COMMISSION_BPS): number {
  if (!Number.isInteger(grossValueCents) || grossValueCents < 0) {
    throw new Error("grossValueCents deve ser um inteiro não negativo (centavos)");
  }
  const commissionCents = Math.floor((grossValueCents * commissionBps) / 10000);
  const net = grossValueCents - commissionCents;
  return net < 0 ? 0 : net;
}

/** Comissão em centavos (o complemento do líquido). */
export function commissionCentsFor(
  grossValueCents: number,
  commissionBps = PLATFORM_COMMISSION_BPS
): number {
  return grossValueCents - netCentsFor(grossValueCents, commissionBps);
}

/**
 * Etapa 7.3d — taxa de saque estimada que a EMPRESA paga no modelo NEW.
 *
 * É uma estimativa da taxa que o profissional pagaria ao sacar o valor
 * (saque manual continua sendo pago por ele). O valor real da taxa do
 * provedor só é conhecido no momento do saque; a diferença é conciliada.
 *
 * Regra de produto: até R$ 250,00 -> R$ 0,08; acima -> R$ 2,00.
 */
export function estimateWithdrawalFeeCents(grossValueCents: number): number {
  if (!Number.isInteger(grossValueCents) || grossValueCents < 0) {
    throw new Error("grossValueCents deve ser um inteiro não negativo (centavos)");
  }
  return grossValueCents <= 25000 ? 8 : 200;
}

/**
 * Preço do impulsionamento "Publicar com urgência": R$10,00 fixo (valor
 * definido em findings.md). Fica aqui — e não solto na rota — porque a Fase 5
 * torna isso editável nas Configurações Financeiras.
 */
export const DEFAULT_BOOST_PRICE_CENTS = 1000;

/**
 * Fase 5b — getters assíncronos das configurações financeiras editáveis.
 *
 * As constantes acima continuam sendo o FALLBACK estático (banco fora do ar,
 * linha ausente). Quem cobra/repassa dinheiro deve usar os getters; o valor
 * congelado em Hiring.commissionBps nunca é reescrito.
 */
export {
  getCommissionBps,
  getBoostPriceCents,
  getWithdrawalFeeBps,
} from "../services/settingsService";
