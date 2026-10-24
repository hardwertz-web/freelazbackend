"use client";

import { useState } from "react";
import { apiPost } from "@/lib/apiClient";
import type { HiringCodeResponse, HiringDetailResponse } from "@/lib/apiTypes";
import { Button } from "@/components/Button";
import { CopyIcon } from "@/components/Icons";
import styles from "./ShiftCodeCard.module.css";

type Hiring = HiringDetailResponse["hiring"];
type Phase = "OPENING" | "CLOSING";

const HOUR_MS = 60 * 60 * 1000;

function when(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(date)
    .replace(".", "");
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day}, ${time}`;
}

/**
 * Card do código de turno dentro da conversa.
 *
 * Contrato real (ver api/hirings/[id]/codes):
 *  - só a EMPRESA confirma (POST); o profissional recebe 403 se tentar;
 *  - o GET do hiring devolve `openingCode`/`closingCode` para as duas partes;
 *  - o código é gerado ~1h antes de `startsAt`/`endsAt` (55–65 min) por job
 *    periódico — NÃO existe janela de expiração na confirmação;
 *  - 5 tentativas erradas bloqueiam o canal (422 com "bloqueado após").
 *
 * Por isso: quem MOSTRA (profissional) vê o código em destaque + copiar;
 * quem CONFIRMA (empresa) vê o campo de digitação. A validação de lado é do
 * backend — a tela só usa `hiring.side`, que vem na resposta.
 */
export function ShiftCodeCard({
  hiring,
  onUpdated,
}: {
  hiring: Hiring;
  onUpdated: (patch: HiringCodeResponse["hiring"]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);

  const phase: Phase | null =
    hiring.status === "RETIDO" ? "OPENING" : hiring.status === "EM_ANDAMENTO" ? "CLOSING" : null;

  if (!phase) {
    if (hiring.status === "CONCLUIDO") {
      return (
        <section className={styles.card} aria-live="polite">
          <span className={styles.label}>Serviço concluído</span>
          <span className={styles.terminalText}>
            Concluído em {when(hiring.completedAt ?? hiring.closingCodeUsedAt)}.
          </span>
        </section>
      );
    }
    if (hiring.status === "CANCELADO") {
      return (
        <section className={styles.card} aria-live="polite">
          <span className={styles.label}>Contratação cancelada</span>
          <span className={styles.terminalText}>Esta contratação foi cancelada.</span>
        </section>
      );
    }
    if (hiring.status === "EM_DISPUTA") {
      return (
        <section className={styles.card} aria-live="polite">
          <span className={styles.label}>Contratação em disputa</span>
          <span className={styles.terminalText}>
            Os códigos de turno ficam indisponíveis durante a disputa.
          </span>
        </section>
      );
    }
    if (hiring.status === "LIBERADO") {
      return (
        <section className={styles.card} aria-live="polite">
          <span className={styles.label}>Contratação finalizada</span>
          <span className={styles.terminalText}>
            Serviço concluído em {when(hiring.completedAt ?? hiring.closingCodeUsedAt)}.
          </span>
        </section>
      );
    }
    return null;
  }

  const isContractor = hiring.side === "CONTRACTOR";
  const isOpening = phase === "OPENING";
  const code = isOpening ? hiring.openingCode : hiring.closingCode;
  const shiftEdge = isOpening ? hiring.jobPosting.startsAt : hiring.jobPosting.endsAt;
  const availableAt = new Date(new Date(shiftEdge).getTime() - HOUR_MS);
  const availableInFuture = availableAt.getTime() > Date.now();

  const title = isOpening ? "Código de abertura" : "Código de fechamento";
  const step = isOpening ? "Início do turno" : "Fim do turno";

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem clipboard (permissão/contexto): o código continua visível na tela.
    }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!/^\d{6}$/.test(value)) {
      setError("Digite os 6 dígitos do código.");
      return;
    }
    if (submitting || blocked) return;

    setSubmitting(true);
    setError(null);

    const result = await apiPost<HiringCodeResponse>(
      `/api/hirings/${encodeURIComponent(hiring.id)}/codes`,
      { kind: phase, code: value }
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      if (/bloqueado ap[oó]s/i.test(result.error)) setBlocked(true);
      return;
    }

    setDraft("");
    onUpdated(result.data.hiring);
  }

  return (
    <section className={styles.card} aria-live="polite">
      <div className={styles.head}>
        <span className={styles.label}>{title}</span>
        <span className={styles.step}>{step}</span>
      </div>

      {code ? (
        <>
          {isContractor ? (
            <form className={styles.form} onSubmit={(event) => void confirm(event)}>
              <p className={styles.hint}>
                Peça o código de 6 dígitos ao profissional e confirme para{" "}
                {isOpening ? "iniciar" : "concluir"} o turno.
              </p>
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value.replace(/\D/g, "").slice(0, 6));
                    setError(null);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  aria-label={isOpening ? "Código de abertura" : "Código de fechamento"}
                  disabled={submitting || blocked}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting || blocked || draft.trim().length !== 6}
                >
                  {submitting ? "Confirmando..." : "Confirmar código"}
                </Button>
              </div>
            </form>
          ) : (
            <div className={styles.showRow}>
              <span className={styles.code} aria-label={title}>
                {code}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void copyCode()}>
                <CopyIcon size={14} /> {copied ? "Copiado!" : "Copiar"}
              </Button>
            </div>
          )}

          {!isContractor && (
            <p className={styles.hint}>
              Mostre este código à empresa {isOpening ? "no início" : "no fim"} do turno.
            </p>
          )}

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          <p className={styles.wait}>
            {availableInFuture
              ? `Disponível a partir de ${when(availableAt.toISOString())}`
              : "O código ainda não foi liberado."}
          </p>
          <p className={styles.hint}>
            {isOpening
              ? "O código de abertura é gerado automaticamente 1h antes do início do turno."
              : "O código de fechamento é gerado automaticamente 1h antes do fim do turno."}
          </p>
        </>
      )}
    </section>
  );
}
