"use client";

import { useState } from "react";
import { apiPost } from "@/lib/apiClient";
import type { HiringDetailResponse, HiringEvaluationPeer } from "@/lib/apiTypes";
import { Button } from "@/components/Button";
import { StarIcon } from "@/components/Icons";
import styles from "./EvaluationCard.module.css";

type Hiring = HiringDetailResponse["hiring"];

const MAX_COMMENT = 500;

function formatDeadline(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(".", "");
}

/** 5 estrelas. Sem `onChange` vira somente leitura (resultado revelado). */
function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange?: (rating: number) => void;
}) {
  return (
    <div
      className={styles.stars}
      role={onChange ? "radiogroup" : undefined}
      aria-label="Nota de 1 a 5 estrelas"
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value;
        return (
          <button
            key={star}
            type="button"
            className={[styles.star, active && styles.starActive].filter(Boolean).join(" ")}
            disabled={!onChange}
            onClick={() => onChange?.(star)}
            aria-label={`${star} ${star === 1 ? "estrela" : "estrelas"}`}
            aria-pressed={onChange ? value === star : undefined}
          >
            <StarIcon size={22} filled={active} />
          </button>
        );
      })}
    </div>
  );
}

function PeerEvaluation({
  title,
  peer,
}: {
  title: string;
  peer: HiringEvaluationPeer;
}) {
  return (
    <div className={styles.peer}>
      <span className={styles.peerLabel}>{title}</span>
      <Stars value={peer.rating ?? 0} />
      <span className={styles.comment}>
        {peer.comment?.trim() ? peer.comment : "Sem comentário."}
      </span>
    </div>
  );
}

/**
 * Card de avaliação mútua CEGA dentro da conversa (Fase 2.3b).
 *
 * Só aparece quando `hiring.status === "CONCLUIDO"` (ver ChatScreen). A API
 * entrega `evaluations: { mine, theirs, revealed, deadline }`:
 *  - `mine` é sempre visível para quem escreveu;
 *  - `theirs` só traz nota/comentário quando `revealed = true`;
 *  - o prazo (`deadline`) é `closingCodeUsedAt + 30d`.
 *
 * O envio usa o contrato real de `POST /api/evaluations`:
 * `{ hiringId, rating, comment }` — o autor vem da sessão, nunca do body.
 */
export function EvaluationCard({
  hiring,
  onSubmitted,
}: {
  hiring: Hiring;
  onSubmitted: () => void | Promise<void>;
}) {
  const evaluations = hiring.evaluations;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!evaluations) return null;

  const mine = evaluations.mine;
  const theirs = evaluations.theirs;
  const mineExists = Boolean(mine?.exists);
  const theirsExists = Boolean(theirs?.exists);
  const deadline = evaluations.deadline;
  const expired = deadline ? Date.now() > new Date(deadline).getTime() : false;

  async function submit() {
    if (submitting) return;
    if (rating < 1) {
      setError("Escolha de 1 a 5 estrelas antes de enviar.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await apiPost<{ evaluation: unknown }>("/api/evaluations", {
      hiringId: hiring.id,
      rating,
      comment: comment.trim(),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSent(true);
    await onSubmitted();
  }

  // 1) As duas avaliações liberadas: mostra a nota e o comentário de cada lado.
  if (mineExists && evaluations.revealed && theirsExists) {
    return (
      <section className={styles.card} aria-live="polite">
        <div className={styles.head}>
          <span className={styles.label}>Avaliações reveladas</span>
        </div>
        <PeerEvaluation title="Sua avaliação" peer={mine!} />
        <PeerEvaluation title="Avaliação da contraparte" peer={theirs!} />
      </section>
    );
  }

  // 2) Já avaliou e a contraparte ainda não: segura a nota dela.
  if (mineExists || sent) {
    return (
      <section className={styles.card} aria-live="polite">
        <div className={styles.head}>
          <span className={styles.label}>{sent ? "Avaliação enviada" : "Sua avaliação"}</span>
          {!expired && deadline && (
            <span className={styles.deadline}>revela até {formatDeadline(deadline)}</span>
          )}
        </div>
        {mine ? (
          <PeerEvaluation title="Você avaliou" peer={mine} />
        ) : (
          <Stars value={rating} />
        )}
        {expired ? (
          <div className={styles.notice} role="status">
            Prazo de avaliação expirou. A contraparte não avaliou dentro dos 30 dias.
          </div>
        ) : (
          <p className={styles.hint}>
            Aguardando avaliação da contraparte. As duas notas são reveladas juntas.
          </p>
        )}
      </section>
    );
  }

  // 3) Prazo vencido sem avaliação: não há mais como avaliar.
  if (expired) {
    return (
      <section className={styles.card} aria-live="polite">
        <span className={styles.label}>Avaliação</span>
        <div className={styles.notice} role="status">
          Prazo de avaliação expirou.
        </div>
        <p className={styles.hint}>
          A janela para avaliar esta contratação era de 30 dias após o fechamento do turno.
        </p>
      </section>
    );
  }

  // 4) Pode avaliar: estrelas + comentário opcional.
  return (
    <section className={styles.card} aria-live="polite">
      <div className={styles.head}>
        <span className={styles.label}>Avalie o serviço</span>
        {deadline && <span className={styles.deadline}>até {formatDeadline(deadline)}</span>}
      </div>
      <p className={styles.hint}>
        Sua nota fica oculta até a contraparte avaliar (ou até o prazo de 30 dias).
      </p>

      <Stars value={rating} onChange={setRating} />

      <textarea
        className={styles.textarea}
        rows={3}
        maxLength={MAX_COMMENT}
        value={comment}
        onChange={(event) => {
          setComment(event.target.value);
          setError(null);
        }}
        placeholder="Conte como foi o serviço (opcional)"
        aria-label="Comentário da avaliação"
        disabled={submitting}
      />
      <span className={styles.counter}>
        {comment.length}/{MAX_COMMENT}
      </span>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <Button size="sm" onClick={() => void submit()} disabled={submitting || rating < 1}>
        {submitting ? "Enviando..." : "Enviar avaliação"}
      </Button>
    </section>
  );
}
