"use client";

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/apiClient";
import type { HiringDetailResponse } from "@/lib/apiTypes";
import { Button } from "@/components/Button";
import styles from "./CheckInCard.module.css";

type Hiring = HiringDetailResponse["hiring"];

const WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000; // 2h antes do início
const WINDOW_AFTER_MS = 30 * 60 * 1000; // 30min depois do início
const TICK_MS = 30_000;

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(".", "");
}

function clock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

/** "1h 20min" / "12min" — usado no aviso de abertura da janela. */
function remaining(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function requestPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocalização indisponível neste dispositivo."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
    });
  });
}

/**
 * Card de check-in por geolocalização (Fase 4a).
 *
 * Só aparece para o PROFISSIONAL com contratação RETIDO e sem check-in.
 * A janela (2h antes → 30min depois de `jobPosting.startsAt`) é a MESMA do
 * backend (`checkInService`): a tela só antecipa o estado; o servidor valida.
 * Fora da janela o botão não é exibido, para não gerar erro previsível.
 */
export function CheckInCard({
  hiring,
  onCheckedIn,
}: {
  hiring: Hiring;
  onCheckedIn: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProfessional = hiring.side === "PROFESSIONAL";
  const isOpenShift = hiring.status === "RETIDO" || hiring.status === "EM_ANDAMENTO";
  const startMs = new Date(hiring.jobPosting.startsAt).getTime();
  const hasStart = Number.isFinite(startMs);
  const rangeStart = hasStart ? startMs - WINDOW_BEFORE_MS : 0;
  const rangeEnd = hasStart ? startMs + WINDOW_AFTER_MS : 0;

  // Mantém o aviso "abre em X" atualizado sem depender do polling do chat.
  useEffect(() => {
    if (!isProfessional || !isOpenShift || hiring.checkIn) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [isProfessional, isOpenShift, hiring.checkIn]);

  // Check-in é registrado apenas pelo profissional.
  if (!isProfessional) return null;

  if (hiring.checkIn) {
    if (!isOpenShift) return null;
    return (
      <section className={styles.card} aria-live="polite">
        <div className={styles.head}>
          <span className={styles.label}>Presença confirmada</span>
          <span className={styles.okBadge}>Check-in</span>
        </div>
        <span className={styles.hint}>
          Registrada às {clock(hiring.checkIn.recordedAt)}.
          {hiring.checkIn.accuracyMeters != null
            ? ` Precisão de ±${Math.round(hiring.checkIn.accuracyMeters)} m.`
            : ""}
        </span>
      </section>
    );
  }

  // A janela é do INÍCIO do turno: só faz sentido com a contratação RETIDA.
  if (hiring.status !== "RETIDO" || !hasStart) return null;

  const inside = now >= rangeStart && now <= rangeEnd;
  const before = now < rangeStart;

  async function handleCheckIn() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    let position: GeolocationPosition;
    try {
      position = await requestPosition();
    } catch {
      setSubmitting(false);
      alert("Permita o acesso à localização para fazer check-in");
      return;
    }

    const result = await apiPost<{ created: boolean }>(
      `/api/hirings/${encodeURIComponent(hiring.id)}/check-in`,
      {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : null,
      }
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onCheckedIn();
  }

  return (
    <section className={styles.card} aria-live="polite">
      <div className={styles.head}>
        <span className={styles.label}>Confirmar presença</span>
        <span className={styles.step}>Início do turno</span>
      </div>

      {inside ? (
        <>
          <span className={styles.hint}>
            Envie sua localização para registrar presença no turno. Vale como evidência
            para a empresa e para disputas.
          </span>
          <Button size="sm" onClick={() => void handleCheckIn()} disabled={submitting}>
            {submitting ? "Registrando..." : "Fazer check-in"}
          </Button>
        </>
      ) : before ? (
        <span className={styles.wait}>
          Check-in abre em {remaining(rangeStart - now)} (
          {when(new Date(rangeStart).toISOString())}).
        </span>
      ) : (
        <span className={styles.wait}>
          A janela de check-in encerrou em {when(new Date(rangeEnd).toISOString())}.
        </span>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
