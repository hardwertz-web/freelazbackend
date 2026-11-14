import { prisma } from "../lib/prisma";
import type { Db } from "../lib/db";

/**
 * Configurações financeiras editáveis (Fase 5b).
 *
 * Cache em memória com TTL 60s: getters de valor quente (comissão, boost,
 * taxa de saque) são lidos em cada contratação/cobrança — o cache evita uma
 * query por leitura. Após POST, o cache é INVALIDADO explicitamente para
 * propagação imediata no mesmo processo.
 *
 * Trade-offs conhecidos: o cache é por processo (com múltiplas instâncias a
 * propagação pode levar até 60s) e o valor é lido de `PlatformSetting` — se a
 * linha não existir, cai no fallback de fábrica e cacheia esse fallback.
 *
 * IMPORTANTE: o valor de comissão congelado em Hiring.commissionBps NUNCA é
 * atualizado por aqui. Mudar a config afeta apenas NOVAS contratações.
 */

type CachedValue = { value: string; expiresAt: number };
const CACHE = new Map<string, CachedValue>();
const TTL_MS = 60_000;

export const SETTINGS_KEYS = {
  COMMISSION_BPS: "commission_bps",
  BOOST_PRICE_CENTS: "boost_price_cents",
  WITHDRAWAL_FEE_BPS: "withdrawal_fee_bps",
} as const;

export const SETTING_VALIDATION: Record<string, { min: number; max: number }> = {
  [SETTINGS_KEYS.COMMISSION_BPS]: { min: 0, max: 5000 },
  [SETTINGS_KEYS.BOOST_PRICE_CENTS]: { min: 100, max: 10000 },
  [SETTINGS_KEYS.WITHDRAWAL_FEE_BPS]: { min: 0, max: 1000 },
};

export const SETTING_LABELS: Record<string, string> = {
  [SETTINGS_KEYS.COMMISSION_BPS]: "Comissão da plataforma",
  [SETTINGS_KEYS.BOOST_PRICE_CENTS]: "Preço do impulsionamento",
  [SETTINGS_KEYS.WITHDRAWAL_FEE_BPS]: "Taxa do saque instantâneo",
};

export function invalidateSetting(key: string): void {
  CACHE.delete(key);
}

export function invalidateAllSettings(): void {
  CACHE.clear();
}

async function getSettingInt(
  key: string,
  fallback: number,
  db: Db = prisma
): Promise<number> {
  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > now) {
    const parsed = Number.parseInt(cached.value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const row = await db.platformSetting.findUnique({ where: { key } });
  if (!row) {
    CACHE.set(key, { value: String(fallback), expiresAt: now + TTL_MS });
    return fallback;
  }
  CACHE.set(key, { value: row.value, expiresAt: now + TTL_MS });
  const parsed = Number.parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getCommissionBps(db: Db = prisma): Promise<number> {
  return getSettingInt(SETTINGS_KEYS.COMMISSION_BPS, 1000, db);
}

export async function getBoostPriceCents(db: Db = prisma): Promise<number> {
  return getSettingInt(SETTINGS_KEYS.BOOST_PRICE_CENTS, 1000, db);
}

export async function getWithdrawalFeeBps(db: Db = prisma): Promise<number> {
  return getSettingInt(SETTINGS_KEYS.WITHDRAWAL_FEE_BPS, 100, db);
}

export async function listAllSettings() {
  return prisma.platformSetting.findMany({ orderBy: { key: "asc" } });
}

export async function updateSetting(params: {
  key: string;
  value: string;
  updatedById: string;
}) {
  const validation = SETTING_VALIDATION[params.key];
  if (!validation) {
    throw new Error(`Chave desconhecida: ${params.key}`);
  }
  const parsed = Number.parseInt(params.value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error("value deve ser um inteiro");
  }
  if (parsed < validation.min || parsed > validation.max) {
    throw new Error(
      `value fora do intervalo permitido (${validation.min}–${validation.max})`
    );
  }

  const updated = await prisma.platformSetting.update({
    where: { key: params.key },
    data: { value: String(parsed), updatedById: params.updatedById },
  });

  invalidateSetting(params.key);
  return updated;
}
