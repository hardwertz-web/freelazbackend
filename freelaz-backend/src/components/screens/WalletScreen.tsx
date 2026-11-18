"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type {
  CompanyWalletResponse,
  CompanyWithdrawalRow,
  StatementItem,
  WalletResponse,
} from "@/lib/apiTypes";
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

type WalletScreenProps = {
  user: {
    name: string;
    tradeName: string | null;
    verificationStatus: string;
  };
  activeMode?: "PROFISSIONAL" | "CONTRATANTE" | "BOTH";
  hasProfessionalRole?: boolean;
  hasContractorRole?: boolean;
};

const MIN_WITHDRAWAL_CENTS = 2000; // R$ 20,00

const PAYOUT_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  PROCESSANDO: "Em processamento",
  CONCLUIDO: "Concluído",
  FALHOU: "Falhou",
};

const WITHDRAWAL_LABEL: Record<CompanyWithdrawalRow["status"], string> = {
  PROCESSING: "Em processamento",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};

function withdrawalTone(status: CompanyWithdrawalRow["status"]): "success" | "primary" | "danger" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  return "primary";
}

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
export function WalletScreen({
  user,
  activeMode = "PROFISSIONAL",
  hasProfessionalRole = false,
  hasContractorRole = false,
}: WalletScreenProps) {
  const router = useRouter();
  const [data, setData] = useState<WalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleBlocked, setRoleBlocked] = useState(false);

  const load = useCallback(async () => {
    if (activeMode === "CONTRATANTE") {
      setLoading(false);
      return;
    }
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
  }, [activeMode]);

  useEffect(() => {
    void load();
  }, [load]);

  // Guard: modo CONTRATANTE sem o papel ativo cai aqui (em vez de chamar
  // /api/wallet/company e receber 403 genérico).
  if (activeMode === "CONTRATANTE" && !hasContractorRole) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Carteira</h1>
          <p className={styles.subtitle}>Seu saldo e movimentações.</p>
        </div>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Papel Contratante não está ativo</span>
            <span className={styles.emptyText}>
              A carteira empresarial existe apenas para contas com o papel Contratante ativo.
              Ative o papel para pagar e receber reembolsos.
            </span>
            <Button size="sm" onClick={() => router.push("/perfil")}>
              Ir para o perfil
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Carteira da empresa: saldo de reembolsos e extrato (Fase 1/2).
  if (activeMode === "CONTRATANTE") {
    return <CompanyWalletView />;
  }

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

  if (roleBlocked || !hasProfessionalRole) {
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
              A carteira existe apenas para contas com o papel Profissional ativo. Envie
              seus documentos para ativar.
            </span>
            <Button size="sm" onClick={() => router.push("/perfil/editar")}>
              Enviar documentos
            </Button>
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
      <div className={styles.welcome}>
        <div className={styles.welcomeText}>
          <span className={styles.welcomeTitle}>Olá, {user.tradeName ?? user.name}!</span>
          <span className={styles.welcomeSubtitle}>Seu saldo e movimentações em um só lugar.</span>
        </div>
        {user.verificationStatus === "VERIFICADO" && (
          <Badge tone="success">Conta verificada</Badge>
        )}
      </div>

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

const COMPANY_ENTRY_LABEL: Record<
  CompanyWalletResponse["entries"][number]["type"],
  string
> = {
  REFUND_CREDIT: "Reembolso",
  HIRING_DEBIT: "Pagamento de vaga",
  WITHDRAWAL_DEBIT: "Saque",
  ADJUSTMENT: "Ajuste",
};

function isCompanyCredit(entry: CompanyWalletResponse["entries"][number]): boolean {
  return entry.type === "REFUND_CREDIT" || (entry.type === "ADJUSTMENT" && entry.amountCents > 0);
}

/** Carteira da empresa: saldo de reembolsos, extrato e saque via Pix (Fase 4). */
function CompanyWalletView() {
  const [data, setData] = useState<CompanyWalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPixKey, setWithdrawPixKey] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiGet<CompanyWalletResponse>("/api/wallet/company?limit=50");
    if (result.ok) {
      setData(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleWithdraw(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountReais = Number(withdrawAmount.replace(",", "."));
    const amountCents = Math.round(amountReais * 100);
    if (withdrawing || !Number.isInteger(amountCents) || amountCents < MIN_WITHDRAWAL_CENTS) {
      return;
    }
    setWithdrawing(true);
    setWithdrawError(null);
    const result = await apiPost<{ withdrawalId: string; providerTransferId: string | null }>(
      "/api/wallet/company/withdraw",
      { amountCents, pixKey: withdrawPixKey }
    );
    if (result.ok) {
      setShowWithdrawModal(false);
      setWithdrawAmount("");
      setWithdrawPixKey("");
      await load();
    } else {
      setWithdrawError(result.error);
    }
    setWithdrawing(false);
  }

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Carteira</h1>
          <p className={styles.subtitle}>Seu saldo para contratações.</p>
        </div>
        <div className={styles.skeleton} />
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </div>
    );
  }

  if (!data) {
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

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Carteira</h1>
        <p className={styles.subtitle}>Seu saldo para contratações.</p>
      </div>

      <section className={styles.balance}>
        <div className={styles.balanceTop}>
          <WalletIcon size={16} /> Saldo disponível
        </div>
        <div className={styles.balanceValue}>{formatBRL(data.availableCents)}</div>
        <div className={styles.balanceMeta}>
          Créditos {formatBRL(data.creditedCents)} · Débitos {formatBRL(data.debitedCents)}
        </div>
        <button
          type="button"
          className={styles.balanceButton}
          onClick={() => {
            setWithdrawError(null);
            setShowWithdrawModal(true);
          }}
          disabled={data.availableCents < MIN_WITHDRAWAL_CENTS}
          title={data.availableCents < MIN_WITHDRAWAL_CENTS ? "Mínimo R$ 20,00" : "Sacar via Pix"}
        >
          <ArrowUpRightIcon size={13} /> Sacar
        </button>
        {data.availableCents < MIN_WITHDRAWAL_CENTS && (
          <div className={styles.balanceMeta}>Mínimo R$ 20,00 para sacar</div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Movimentações</h2>
          <span className={styles.sectionHint}>{data.entries.length} lançamento(s)</span>
        </div>

        {data.entries.length === 0 ? (
          <Card>
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>Nenhuma movimentação ainda</span>
              <span className={styles.emptyText}>
                Quando uma contratação for cancelada, o reembolso aparece aqui como saldo.
              </span>
            </div>
          </Card>
        ) : (
          <div className={styles.list}>
            {data.entries.map((entry) => {
              const credit = isCompanyCredit(entry);
              return (
                <div key={entry.id} className={styles.statementRow}>
                  <span
                    className={[styles.statementIcon, credit ? styles.credit : styles.debit].join(" ")}
                  >
                    {credit ? <ArrowDownLeftIcon size={16} /> : <BanknoteIcon size={16} />}
                  </span>
                  <span className={styles.statementBody}>
                    <span className={styles.statementLabel}>{COMPANY_ENTRY_LABEL[entry.type]}</span>
                    <span className={styles.statementMeta}>
                      {formatListTime(entry.createdAt)}
                      {entry.hiring?.jobTitle ? ` · ${entry.hiring.jobTitle}` : ""}
                    </span>
                    <span className={styles.statementMeta}>{entry.reason}</span>
                  </span>
                  <span className={styles.statementRight}>
                    <span className={credit ? styles.amountIn : styles.amountOut}>
                      {credit ? "+" : "−"} {formatBRL(Math.abs(entry.amountCents))}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {(data.withdrawals?.length ?? 0) > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Saques</h2>
            <span className={styles.sectionHint}>{data.withdrawals?.length} saque(s)</span>
          </div>
          <div className={styles.list}>
            {data.withdrawals?.map((withdrawal) => (
              <div key={withdrawal.id} className={styles.statementRow}>
                <span className={[styles.statementIcon, styles.debit].join(" ")}>
                  <ArrowUpRightIcon size={16} />
                </span>
                <span className={styles.statementBody}>
                  <span className={styles.statementLabel}>{formatBRL(withdrawal.amountCents)}</span>
                  <span className={styles.statementMeta}>{withdrawal.pixKey}</span>
                  {withdrawal.failureReason && (
                    <span className={styles.statementMeta}>{withdrawal.failureReason}</span>
                  )}
                </span>
                <span className={styles.statementRight}>
                  <Badge tone={withdrawalTone(withdrawal.status)}>
                    {WITHDRAWAL_LABEL[withdrawal.status]}
                  </Badge>
                  <span className={styles.statementMeta}>{formatListTime(withdrawal.createdAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={styles.footerNote}>
        O saldo pode ser usado para pagar novas contratações ou sacado via Pix para a chave
        informada. Saques abaixo de R$ 20,00 não são permitidos.
      </div>

      {showWithdrawModal && (
        <div
          className={styles.withdrawModal}
          role="presentation"
          onMouseDown={() => !withdrawing && setShowWithdrawModal(false)}
        >
          <div
            className={styles.withdrawForm}
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="withdraw-modal-title" className={styles.modalTitle}>
              Sacar via Pix
            </h2>
            <p className={styles.modalText}>
              Sem taxa de saque nesta etapa: o valor debitado é o valor que você recebe.
            </p>

            <form className={styles.withdrawFields} onSubmit={handleWithdraw}>
              {withdrawError && (
                <div className={styles.withdrawError} role="alert">
                  {withdrawError}
                </div>
              )}
              <label className={styles.withdrawField}>
                <span className={styles.withdrawLabel}>Valor do saque (R$)</span>
                <input
                  className={styles.withdrawInput}
                  type="number"
                  min={20}
                  step="0.01"
                  value={withdrawAmount}
                  onChange={(event) => setWithdrawAmount(event.target.value)}
                  placeholder="20,00"
                  autoFocus
                  required
                />
                <span className={styles.withdrawHint}>
                  Mínimo R$ 20,00 · Disponível {formatBRL(data.availableCents)}
                </span>
              </label>
              <label className={styles.withdrawField}>
                <span className={styles.withdrawLabel}>Chave Pix</span>
                <input
                  className={styles.withdrawInput}
                  type="text"
                  value={withdrawPixKey}
                  onChange={(event) => setWithdrawPixKey(event.target.value)}
                  placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória"
                  required
                />
              </label>
              <div className={styles.withdrawPreview}>
                Você recebe: {formatBRL(Math.round(Number(withdrawAmount.replace(",", ".")) * 100) || 0)}
              </div>
              <div className={styles.withdrawActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowWithdrawModal(false)}
                  disabled={withdrawing}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    withdrawing ||
                    !Number.isFinite(Number(withdrawAmount.replace(",", "."))) ||
                    Math.round(Number(withdrawAmount.replace(",", ".")) * 100) < MIN_WITHDRAWAL_CENTS ||
                    Math.round(Number(withdrawAmount.replace(",", ".")) * 100) > data.availableCents ||
                    withdrawPixKey.trim().length < 5
                  }
                >
                  {withdrawing ? "Sacando..." : "Confirmar saque"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
