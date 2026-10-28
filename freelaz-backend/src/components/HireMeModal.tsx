"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/apiClient";
import { humanizeCategory } from "@/lib/format";
import { Button } from "@/components/Button";
import { LockIcon, XIcon } from "@/components/Icons";
import styles from "./HireMeModal.module.css";

type HireMeModalProps = {
  professionalId: string;
  professionalName: string;
  categories: string[];
  onClose: () => void;
};

type InviteResponse = {
  jobPosting: { id: string };
};

/** "2026-10-27T18:00" no fuso local (valor de datetime-local). */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function defaultShift(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 0, 0, 0);
  return { start: localInputValue(start), end: localInputValue(end) };
}

function brlToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

/**
 * Modal "Me contrate".
 *
 * O corpo enviado a `POST /api/jobs/invite` precisa respeitar o contrato real
 * da vaga: título 3–120, descrição 10–4000, categoria obrigatória, valor
 * inteiro em centavos e um turno com início/fim. A UI mantém os limites
 * pedidos para a fase (título ≥5, descrição ≤500) e acrescenta categoria e
 * datas — sem eles o backend devolve 422.
 */
export function HireMeModal({
  professionalId,
  professionalName,
  categories,
  onClose,
}: HireMeModalProps) {
  const router = useRouter();
  const shift = useRef(defaultShift());

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [startsAt, setStartsAt] = useState(shift.current.start);
  const [endsAt, setEndsAt] = useState(shift.current.end);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successJobId, setSuccessJobId] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  useEffect(() => {
    if (!successJobId) return;
    const timer = window.setTimeout(() => {
      router.push(`/vaga/${successJobId}`);
      router.refresh();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [successJobId, router]);

  const valueCents = brlToCents(value);
  const valid =
    title.trim().length >= 5 &&
    title.trim().length <= 120 &&
    description.trim().length >= 10 &&
    description.trim().length <= 500 &&
    category.trim().length > 0 &&
    valueCents > 0 &&
    Boolean(startsAt) &&
    Boolean(endsAt);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || submitting) return;

    setSubmitting(true);
    setError(null);

    const result = await apiPost<InviteResponse>("/api/jobs/invite", {
      targetProfessionalId: professionalId,
      title: title.trim(),
      description: description.trim(),
      category: category.trim().toLowerCase(),
      valueCents,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    });

    if (result.ok) {
      setSuccessJobId(result.data.jobPosting.id);
      return;
    }

    if (result.status === 403) {
      setError("Você não pode contratar a si mesmo.");
    } else if (result.status === 401) {
      setError("Sua sessão expirou. Entre novamente para enviar a proposta.");
    } else {
      setError(result.error);
    }
    setSubmitting(false);
  }

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={() => !submitting && onClose()}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hire-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 id="hire-modal-title" className={styles.title}>
              Me contrate
            </h2>
            <p className={styles.subtitle}>
              Envie uma proposta para <strong>{professionalName}</strong>.
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
          >
            <XIcon size={18} />
          </button>
        </div>

        {successJobId ? (
          <div className={styles.success} role="status">
            <span className={styles.successTitle}>Proposta enviada!</span>
            <span className={styles.successText}>
              {professionalName} vai receber a proposta e poderá aceitar, recusar ou
              contrapropor. Abrindo a vaga...
            </span>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.label}>Título da proposta</span>
              <input
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex.: Bartender para festa no sábado"
                maxLength={120}
                minLength={5}
                required
                autoFocus
              />
              <span className={styles.hint}>5 a 120 caracteres.</span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Descrição</span>
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Conte o que precisa: local, público, dress code, equipamentos..."
                maxLength={500}
                minLength={10}
                rows={3}
                required
              />
              <span className={styles.hint}>
                {description.trim().length}/500 — mínimo 10 caracteres (exigência do backend).
              </span>
            </label>

            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Categoria</span>
                {categories.length > 0 ? (
                  <select
                    className={styles.input}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    required
                  >
                    {categories.map((item) => (
                      <option key={item} value={item}>
                        {humanizeCategory(item)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.input}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder="Ex.: bartender"
                    maxLength={60}
                    required
                  />
                )}
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Valor (R$)</span>
                <input
                  className={styles.input}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="250,00"
                  inputMode="decimal"
                  required
                />
                <span className={styles.hint}>
                  {valueCents > 0 ? `Será enviado como ${valueCents} centavos.` : "Valor maior que zero."}
                </span>
              </label>
            </div>

            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Início</span>
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Fim</span>
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                />
              </label>
            </div>

            <p className={styles.terms}>
              <LockIcon size={12} /> A proposta é privada: só {professionalName} vê. Ela
              expira automaticamente em 7 dias sem resposta.
            </p>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose} disabled={submitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!valid || submitting}>
                {submitting ? "Enviando..." : "Enviar proposta"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
