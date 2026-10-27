"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/apiClient";
import type { StatementItem, WalletResponse } from "@/lib/apiTypes";
import { formatBRL, formatDay, formatListTime } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BanknoteIcon,
  ClockIcon,
  InfoIcon,
  PlusIcon,
  WalletIcon,
} from "@/components/Icons";
import styles from "./WalletScreen.module.css";

const PAYOUT_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  PROCESSANDO: "Em processamento",
  CONCLUIDO: "Concluído",
  FALHOU: "Falhou",
};

function payoutTone(status?: string): "success" | "primary" | "danger" | "neutral" {
  if (status === "CONCLUIDO") return "success";
  if (status === "FALHOU") return "danger";
  if (status === "PENDENTE" || status === "PROCESSANDO") return "primary";
  return "neutral";
}

/**
 * Carteira do profissional: saldo calculado pelo backend a partir das
 * contratações/payouts (nunca um número guardado) + extrato real.
 *
 * As ações rápidas (depositar/sacar/transferir) são Fase 2 — aparecem
 * desabilitadas, sem simular dinheiro.
 */
export function WalletScreen() {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleBlocked, setRoleBlocked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRoleBlocked(false);
    const result = await apiGet<WalletResponse>("/api/wallet?limit=50");
    if (result.ok) {
      setData(result.data);
    } else if (result.status === 403) {
      setRoleBlocked(true);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Carteira</h1>
          <p className={styles.subtitle}>Seu saldo e movimentações.</p>
        </div>
        <div className={styles.skeleton} />
        <div className={styles.summaryGrid}>
          <div className={styles.skeleton} style={{ height: 64 }} />
          <div className={styles.skeleton} style={{ height: 64 }} />
        </div>
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </div>
    );
  }

  if (roleBlocked) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Carteira</h1>
          <p className={styles.subtitle}>Seu saldo e movimentações.</p>
        </div>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Papel Profissional não está ativo</span>
            <span className={styles.emptyText}>
              A carteira existe apenas para contas com o papel Profissional ativo. Ative o
              papel (verificação de documento) para receber pelos serviços.
            </span>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Carteira</h1>
        </div>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível carregar a carteira</span>
            <span className={styles.emptyText}>{error ?? "Resposta inesperada do servidor"}</span>
            <Button size="sm" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const { wallet, statement } = data;
  const feePercent = (wallet.instantWithdrawalFeeBps / 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
  });

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Carteira</h1>
        <p className={styles.subtitle}>Seu saldo e movimentações.</p>
      </div>

      <section className={styles.balance}>
        <div className={styles.balanceTop}>
          <WalletIcon size={16} /> Saldo disponível
        </div>
        <div className={styles.balanceValue}>{formatBRL(wallet.disponivelCents)}</div>
        <div className={styles.balanceMeta}>
          A receber (serviços em andamento): {formatBRL(wallet.aReceberCents)}
        </div>
        <button type="button" className={styles.balanceButton} disabled title="Saque — Fase 2">
          <InfoIcon size={13} /> Saque instantâneo: {feePercent}% · Fase 2
        </button>
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.action} disabled title="Depositar — Fase 2">
          <span className={styles.actionIcon}>
            <PlusIcon size={17} />
          </span>
          <span className={styles.actionBody}>
            <span className={styles.actionLabel}>Depositar</span>
            <span className={styles.actionHint}>Fase 2</span>
          </span>
        </button>
        <button type="button" className={styles.action} disabled title="Sacar — Fase 2">
          <span className={styles.actionIcon}>
            <ArrowUpRightIcon size={17} />
          </span>
          <span className={styles.actionBody}>
            <span className={styles.actionLabel}>Sacar</span>
            <span className={styles.actionHint}>Fase 2</span>
          </span>
        </button>
        <button type="button" className={styles.action} disabled title="Transferir — Fase 2">
          <span className={styles.actionIcon}>
            <ArrowDownLeftIcon size={17} />
          </span>
          <span className={styles.actionBody}>
            <span className={styles.actionLabel}>Transferir</span>
            <span className={styles.actionHint}>Fase 2</span>
          </span>
        </button>
        <button type="button" className={styles.action} disabled title="Histórico completo — Fase 2">
          <span className={styles.actionIcon}>
            <ClockIcon size={17} />
          </span>
          <span className={styles.actionBody}>
            <span className={styles.actionLabel}>Histórico</span>
            <span className={styles.actionHint}>Fase 2</span>
          </span>
        </button>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Resumo</h2>
          <span className={styles.sectionHint}>calculado pelo backend</span>
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summary}>
            <span className={styles.summaryIcon}>
              <WalletIcon size={15} />
            </span>
            <span className={styles.summaryLabel}>Disponível para saque</span>
            <span className={styles.summaryValue}>{formatBRL(wallet.disponivelCents)}</span>
          </div>
          <div className={styles.summary}>
            <span className={styles.summaryIcon}>
              <ClockIcon size={15} />
            </span>
            <span className={styles.summaryLabel}>A receber</span>
            <span className={styles.summaryValue}>{formatBRL(wallet.aReceberCents)}</span>
          </div>
          <div className={styles.summary}>
            <span className={styles.summaryIcon}>
              <BanknoteIcon size={15} />
            </span>
            <span className={styles.summaryLabel}>Em processamento</span>
            <span className={styles.summaryValue}>{formatBRL(wallet.emProcessamentoCents)}</span>
          </div>
          <div className={styles.summary}>
            <span className={styles.summaryIcon}>
              <ArrowUpRightIcon size={15} />
            </span>
            <span className={styles.summaryLabel}>Total já sacado</span>
            <span className={styles.summaryValue}>{formatBRL(wallet.sacadoCents)}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Movimentações recentes</h2>
          <span className={styles.sectionHint}>{statement.length} lançamento(s)</span>
        </div>

        {statement.length === 0 ? (
          <Card>
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>Nenhuma movimentação ainda</span>
              <span className={styles.emptyText}>
                Quando você concluir um serviço, o pagamento garantido e o repasse aparecem
                aqui.
              </span>
            </div>
          </Card>
        ) : (
          <div className={styles.list}>
            {statement.map((item) => (
              <StatementRow key={`${item.kind}-${item.hiringId}-${item.date}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatementRow({ item }: { item: StatementItem }) {
  const isCredit = item.kind === "CREDITO";
  return (
    <div className={styles.statementRow}>
      <span className={[styles.statementIcon, isCredit ? styles.credit : styles.debit].join(" ")}>
        {isCredit ? <ArrowDownLeftIcon size={16} /> : <BanknoteIcon size={16} />}
      </span>
      <span className={styles.statementBody}>
        <span className={styles.statementLabel}>{item.label}</span>
        <span className={styles.statementMeta}>
          {formatDay(item.date)}
          {!isCredit && item.feeCents != null && item.feeCents > 0 && (
            <> · taxa {formatBRL(item.feeCents)}</>
          )}
        </span>
      </span>
      <span className={styles.statementRight}>
        <span className={isCredit ? styles.amountIn : styles.amountOut}>
          {isCredit ? "+" : "−"} {formatBRL(item.amountCents)}
        </span>
        {!isCredit && item.status && (
          <Badge tone={payoutTone(item.status)}>
            {PAYOUT_LABEL[item.status] ?? item.status}
          </Badge>
        )}
        <span className={styles.statementMeta}>{formatListTime(item.date)}</span>
      </span>
    </div>
  );
}
