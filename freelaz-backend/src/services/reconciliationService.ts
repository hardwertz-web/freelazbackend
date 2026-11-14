import { prisma } from "../lib/prisma";
import {
  computeRetainedBalance,
  computeAdjustedBalance,
  getTotalRetainedOnPlatform,
} from "./ledgerService";

/**
 * Reconciliação diária — a rede de segurança do dinheiro (Governança
 * Financeira). Não move dinheiro: só confere se o que o ledger diz bate com os
 * Payouts e com o status das contratações, e devolve as divergências.
 *
 * Confere invariantes que NUNCA deveriam quebrar:
 *  1. nenhum saldo retido negativo;
 *  2. contratação LIBERADO tem Payout CONCLUIDO;
 *  3. Payout CONCLUIDO tem lançamento de LIBERACAO de igual valor no ledger;
 *  4. pagamento confirmado (status além de AGUARDANDO_PAGAMENTO) tem
 *     RETENCAO igual ao valor bruto;
 *  5. Payout CONCLUIDO implica contratação LIBERADO;
 *  6. nenhum saldo AJUSTADO (operacional - AJUSTE) negativo.
 *
 * A comparação com o extrato REAL do Asaas ainda não é possível sem
 * credencial/sandbox — fica marcada como `external.skipped`.
 */

export type ReconciliationCheck = { name: string; passed: boolean; detail: string };

export type ReconciliationReport = {
  ok: boolean;
  generatedAt: string;
  totals: {
    retainedCents: number;
    adjustedCents: number;
    pendingAdjustmentCents: number;
    hiringCount: number;
    payoutCount: number;
    releasedCount: number;
  };
  checks: ReconciliationCheck[];
  discrepancies: string[];
  external: { skipped: boolean; reason?: string };
};

export async function runReconciliation(): Promise<ReconciliationReport> {
  const [hirings, payouts, retainedCents] = await Promise.all([
    prisma.hiring.findMany({ include: { payout: true, ledgerEntries: true } }),
    prisma.payout.findMany(),
    getTotalRetainedOnPlatform(),
  ]);

  const checks: ReconciliationCheck[] = [];
  const discrepancies: string[] = [];

  // Registra a checagem e, se falhou, acumula a divergência com o mesmo texto.
  const check = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, passed, detail });
    if (!passed) discrepancies.push(`${name}: ${detail}`);
  };

  const negative = hirings
    .map((h) => ({ id: h.id, balance: computeRetainedBalance(h.ledgerEntries) }))
    .filter((x) => x.balance < 0);
  check(
    "sem_saldo_negativo",
    negative.length === 0,
    negative.length === 0
      ? "nenhum saldo retido negativo"
      : negative.map((x) => `${x.id} = ${x.balance}`).join(", ")
  );

  const liberadoSemPayout = hirings.filter(
    (h) => h.status === "LIBERADO" && h.payout?.status !== "CONCLUIDO"
  );
  check(
    "liberado_tem_payout_concluido",
    liberadoSemPayout.length === 0,
    liberadoSemPayout.length === 0
      ? "todo LIBERADO tem Payout CONCLUIDO"
      : liberadoSemPayout.map((h) => h.id).join(", ")
  );

  const hiringById = new Map(hirings.map((h) => [h.id, h]));

  const payoutSemLiberacao = payouts.filter((p) => {
    if (p.status !== "CONCLUIDO") return false;
    const held = hiringById.get(p.hiringId);
    const released = (held?.ledgerEntries ?? [])
      .filter((e) => e.type === "LIBERACAO")
      .reduce((sum, e) => sum + e.amountCents, 0);
    return released !== p.amountCents;
  });
  check(
    "payout_tem_liberacao_no_ledger",
    payoutSemLiberacao.length === 0,
    payoutSemLiberacao.length === 0
      ? "todo Payout CONCLUIDO tem LIBERACAO de igual valor"
      : payoutSemLiberacao.map((p) => p.id).join(", ")
  );

  // Invariante: toda contratação cujo pagamento foi CONFIRMADO (passou de
  // AGUARDANDO_PAGAMENTO e não foi cancelada antes de pagar) tem RETENCAO
  // igual ao bruto. A confirmação é o status, não a presença de
  // providerPaymentId — desde a migração para o Asaas o id é gravado já na
  // criação da cobrança, antes da confirmação.
  const CONFIRMED_STATUSES = ["RETIDO", "EM_ANDAMENTO", "CONCLUIDO", "LIBERADO", "EM_DISPUTA"];
  const pagamentoSemRetencao = hirings.filter((h) => {
    if (!CONFIRMED_STATUSES.includes(h.status)) return false;
    const retained = h.ledgerEntries
      .filter((e) => e.type === "RETENCAO")
      .reduce((sum, e) => sum + e.amountCents, 0);
    return retained !== h.grossValueCents;
  });
  check(
    "pagamento_confirmado_retido",
    pagamentoSemRetencao.length === 0,
    pagamentoSemRetencao.length === 0
      ? "todo pagamento confirmado tem RETENCAO igual ao bruto"
      : pagamentoSemRetencao.map((h) => h.id).join(", ")
  );

  const payoutConcluidoNaoLiberado = payouts.filter((p) => {
    if (p.status !== "CONCLUIDO") return false;
    const held = hiringById.get(p.hiringId);
    return held ? held.status !== "LIBERADO" : true;
  });
  check(
    "payout_concluido_implica_liberado",
    payoutConcluidoNaoLiberado.length === 0,
    payoutConcluidoNaoLiberado.length === 0
      ? "todo Payout CONCLUIDO corresponde a contratação LIBERADO"
      : payoutConcluidoNaoLiberado.map((p) => p.id).join(", ")
  );

  // Check 6 (Fase 5): o saldo AJUSTADO (operacional - AJUSTE) não pode ficar
  // negativo. É o saldo contábil, distinto do operacional: um AJUSTE corrige
  // registro e não pode "comer" mais do que o saldo que deveria existir.
  // A rota de ajuste tem o mesmo guard (409) — este check pega dados legados
  // ou inserção manual direto no ledger.
  const negativeAdjusted = hirings
    .map((h) => ({ id: h.id, balance: computeAdjustedBalance(h.ledgerEntries) }))
    .filter((x) => x.balance < 0);
  check(
    "saldo_ajustado_nao_negativo",
    negativeAdjusted.length === 0,
    negativeAdjusted.length === 0
      ? "nenhum saldo ajustado negativo (operacional - AJUSTE >= 0)"
      : negativeAdjusted.map((x) => `${x.id} = ${x.balance}`).join(", ")
  );

  const adjustedCents = hirings.reduce(
    (sum, h) => sum + computeAdjustedBalance(h.ledgerEntries),
    0
  );

  return {
    ok: discrepancies.length === 0,
    generatedAt: new Date().toISOString(),
    totals: {
      retainedCents,
      adjustedCents,
      pendingAdjustmentCents: retainedCents - adjustedCents,
      hiringCount: hirings.length,
      payoutCount: payouts.length,
      releasedCount: payouts.filter((p) => p.status === "CONCLUIDO").length,
    },
    checks,
    discrepancies,
    external: {
      skipped: true,
      reason:
        "Sem credencial/sandbox do Asaas não dá para comparar com o extrato real da conta.",
    },
  };
}
