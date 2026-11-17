"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChevronLeftIcon, CopyIcon } from "@/components/Icons";
import styles from "./CheckoutScreen.module.css";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 30;

type PixInfo = {
  qrCodeBase64: string | null;
  payload: string | null;
  expirationDate?: string | null;
};

type PaymentCreateResponse = {
  paymentId: string;
  status: string;
  pix: PixInfo | null;
  alreadyCreated?: boolean;
};

type HiringDetail = {
  hiring: {
    id: string;
    status: string;
    jobTitle: string;
    grossValueCents: number;
    chargeAmountCents: number;
    canPayWithWallet: boolean;
    companyBalanceCents: number | null;
    walletCoversFullAmount: boolean;
    counterpart?: { name: string; tradeName: string | null } | null;
  };
};

/** Detecta se o pagamento já foi confirmado / contratação avançou. */
function isPaidStatus(status: string): boolean {
  return status !== "AGUARDANDO_PAGAMENTO";
}

/**
 * Checkout da contratação. Duas formas de pagamento (Fase 3):
 *
 * - Saldo da carteira: se a empresa pode pagar com saldo e ele cobre o total,
 *   NENHUMA cobrança Asaas é criada — o botão paga com HIRING_DEBIT.
 * - Pix: criado quando o saldo não cobre ou quando a empresa clica em
 *   "Prefiro pagar via Pix" (`pixRequested`).
 *
 * Polling de 5s em GET /api/hirings/[id] até o status deixar de ser
 * AGUARDANDO_PAGAMENTO ou 30 tentativas (2,5 min). Isso também cobre o caso
 * de pagamento com saldo feito em outra aba.
 */
export function CheckoutScreen({ hiringId }: { hiringId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [payment, setPayment] = useState<PaymentCreateResponse | null>(null);
  const [hiring, setHiring] = useState<HiringDetail["hiring"] | null>(null);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [pixRequested, setPixRequested] = useState(false);
  const [payingWithWallet, setPayingWithWallet] = useState(false);

  const attemptsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pixAttemptedRef = useRef(false);

  const base = `/api/hirings/${encodeURIComponent(hiringId)}`;

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
  }, []);

  const loadHiring = useCallback(async () => {
    const result = await apiGet<HiringDetail>(base);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setHiring(result.data.hiring);
  }, [base]);

  const checkStatus = useCallback(async () => {
    attemptsRef.current += 1;
    if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
      stopPolling();
      setTimedOut(true);
      return;
    }

    const result = await apiGet<HiringDetail>(base);
    if (result.ok && isPaidStatus(result.data.hiring.status)) {
      stopPolling();
      router.push(`/mensagens/${encodeURIComponent(hiringId)}`);
    }
  }, [base, hiringId, router, stopPolling]);

  const startPolling = useCallback(() => {
    if (polling || timerRef.current) return;
    attemptsRef.current = 0;
    setTimedOut(false);
    setPolling(true);
    void checkStatus();
    timerRef.current = window.setInterval(() => void checkStatus(), POLL_INTERVAL_MS);
  }, [checkStatus, polling]);

  const createPayment = useCallback(async () => {
    pixAttemptedRef.current = true;
    setCreating(true);
    setLoading(true);
    setError(null);
    setUnavailable(false);
    setTimedOut(false);
    attemptsRef.current = 0;

    const result = await apiPost<PaymentCreateResponse>("/api/payments/create", { hiringId });

    if (!result.ok) {
      setCreating(false);
      setLoading(false);
      if (result.status === 503) {
        setUnavailable(true);
      } else if (result.status === 409) {
        // Já não está aguardando pagamento → recarrega; o efeito abaixo cuida
        // do redirecionamento quando o status confirmar pagamento.
        void loadHiring();
      } else {
        setError(result.error);
      }
      return;
    }

    setPayment(result.data);
    setCreating(false);
    setLoading(false);
    void loadHiring();
  }, [hiringId, loadHiring]);

  // Na montagem, SÓ busca o hiring. A decisão de criar Pix vem depois,
  // quando sabemos se o saldo da carteira cobre o valor total.
  useEffect(() => {
    void loadHiring();
    return () => stopPolling();
  }, [loadHiring, stopPolling]);

  // Orquestra: pago em outra aba → redirect; saldo cobre → não cria Pix;
  // caso contrário (ou Pix pedido) → cria cobrança uma única vez.
  useEffect(() => {
    if (!hiring) return;

    if (isPaidStatus(hiring.status)) {
      stopPolling();
      router.push(`/mensagens/${encodeURIComponent(hiringId)}`);
      return;
    }

    startPolling();

    if (hiring.walletCoversFullAmount && !pixRequested) {
      setLoading(false);
      return;
    }

    if (!payment && !pixAttemptedRef.current) {
      void createPayment();
    }
  }, [
    hiring,
    pixRequested,
    payment,
    createPayment,
    startPolling,
    stopPolling,
    router,
    hiringId,
  ]);

  async function handlePayWithWallet() {
    setPayingWithWallet(true);
    setError(null);
    try {
      const res = await apiPost<{ paidWithWallet: boolean; alreadyPaid?: boolean }>(
        "/api/payments/create",
        { hiringId, useWallet: true }
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Sucesso: redireciona para a conversa (mesmo destino do fluxo Pix)
      router.push(`/mensagens/${encodeURIComponent(hiringId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao pagar com saldo");
    } finally {
      setPayingWithWallet(false);
    }
  }

  async function copyPayload() {
    const payload = payment?.pix?.payload;
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silencioso
    }
  }

  const amount = hiring?.chargeAmountCents ?? null;
  const balanceCents = hiring?.companyBalanceCents ?? 0;
  const missingCents = hiring
    ? Math.max(0, hiring.chargeAmountCents - balanceCents)
    : 0;
  const showWalletCard = Boolean(
    hiring?.canPayWithWallet && hiring.walletCoversFullAmount && !pixRequested
  );
  const showWalletInfo = Boolean(
    hiring?.canPayWithWallet &&
      !hiring.walletCoversFullAmount &&
      balanceCents > 0
  );
  const showPixCard = Boolean(
    !hiring?.walletCoversFullAmount || pixRequested || payment !== null
  );
  const qrSrc = payment?.pix?.qrCodeBase64
    ? `data:image/png;base64,${payment.pix.qrCodeBase64}`
    : null;
  const pixText = payment?.pix?.payload;

  if (loading && !payment && !error && !unavailable) {
    return (
      <div className={styles.screen}>
        <header className={styles.head}>
          <button type="button" className={styles.back} onClick={() => router.push("/")}>
            <ChevronLeftIcon size={15} /> Cancelar e voltar
          </button>
          <h1 className={styles.title}>Checkout</h1>
        </header>
        <Card>
          <div className={styles.skeleton} />
        </Card>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className={styles.screen}>
        <header className={styles.head}>
          <button type="button" className={styles.back} onClick={() => router.push("/")}>
            <ChevronLeftIcon size={15} /> Voltar
          </button>
          <h1 className={styles.title}>Checkout</h1>
        </header>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Pagamento indisponível no momento</span>
            <span className={styles.emptyText}>
              O provedor de pagamento (Asaas) não está configurado neste ambiente. Tente
              novamente mais tarde ou fale com o suporte.
            </span>
            <Button onClick={() => void createPayment()} disabled={creating}>
              {creating ? "Tentando..." : "Tentar novamente"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (error && !payment) {
    return (
      <div className={styles.screen}>
        <header className={styles.head}>
          <button type="button" className={styles.back} onClick={() => router.push("/")}>
            <ChevronLeftIcon size={15} /> Voltar
          </button>
          <h1 className={styles.title}>Checkout</h1>
        </header>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível gerar o Pix</span>
            <span className={styles.emptyText}>{error}</span>
            <Button onClick={() => void createPayment()} disabled={creating}>
              {creating ? "Gerando..." : "Tentar novamente"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={() => router.push("/")}>
          <ChevronLeftIcon size={15} /> Voltar
        </button>
        <h1 className={styles.title}>Checkout</h1>
        <p className={styles.subtitle}>{hiring?.jobTitle || "Contratação"}</p>
      </header>

      <Card>
        <div className={styles.amountRow}>
          <span className={styles.amountLabel}>Valor total</span>
          <span className={styles.amountValue}>{amount != null ? formatBRL(amount) : "—"}</span>
        </div>
      </Card>

      {showWalletCard && hiring && (
        <section className={styles.walletSection}>
          <div className={styles.walletHeader}>
            <span className={styles.walletLabel}>Saldo disponível na carteira</span>
            <span className={styles.walletValue}>{formatBRL(balanceCents)}</span>
          </div>
          <Button
            block
            onClick={() => void handlePayWithWallet()}
            disabled={payingWithWallet}
          >
            {payingWithWallet ? "Processando..." : "Pagar com saldo da carteira"}
          </Button>
          <button
            type="button"
            className={styles.walletHint}
            onClick={() => setPixRequested(true)}
          >
            Prefiro pagar via Pix
          </button>
        </section>
      )}

      {showWalletInfo && (
        <section className={styles.walletInfo}>
          Você tem {formatBRL(balanceCents)} na carteira. Faltam{" "}
          {formatBRL(missingCents)} para pagar com saldo.
        </section>
      )}

      {showPixCard && (
        <Card>
          <div className={styles.qrSection}>
            <span className={styles.sectionTitle}>Escaneie o QR Code</span>
            <span className={styles.sectionHint}>
              Abra o app do seu banco e escaneie o QR Code para pagar.
            </span>

            {qrSrc ? (
              <div className={styles.qrWrap}>
                <img className={styles.qrImage} src={qrSrc} alt="QR Code Pix" />
              </div>
            ) : (
              <div className={styles.qrPlaceholder}>
                <span>QR Code não disponível</span>
              </div>
            )}

            {pixText && (
              <div className={styles.copyBlock}>
                <span className={styles.copyLabel}>Pix copia e cola</span>
                <div className={styles.copyRow}>
                  <span className={styles.copyText} title={pixText}>
                    {pixText}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => void copyPayload()}>
                    <CopyIcon size={14} /> {copied ? "Copiado!" : "Copiar código Pix"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className={styles.statusRow}>
          <span className={styles.statusDot} />
          <span className={styles.statusText}>
            {timedOut
              ? "Pagamento não confirmado"
              : "Aguardando confirmação do pagamento..."}
          </span>
        </div>
      </Card>

      {timedOut && (
        <Button block onClick={() => void checkStatus()}>
          Já paguei
        </Button>
      )}

      <span className={styles.footerNote}>
        Assim que o pagamento for confirmado, o chat com o profissional será liberado
        e você será redirecionado automaticamente.
      </span>
    </div>
  );
}
