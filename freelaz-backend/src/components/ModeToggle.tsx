"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/apiClient";
import { BriefcaseIcon, UserIcon } from "./Icons";
import styles from "./ModeToggle.module.css";

type Mode = "PROFISSIONAL" | "CONTRATANTE" | "BOTH";

const LABEL: Record<Mode, string> = {
  PROFISSIONAL: "Modo: Profissional",
  CONTRATANTE: "Modo: Contratante",
  BOTH: "Modo: Ambos",
};

export function ModeToggle({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (mode === "BOTH" || pending) return;
    const prev = mode;
    const optimistic: Mode = mode === "PROFISSIONAL" ? "CONTRATANTE" : "PROFISSIONAL";
    setMode(optimistic);
    setError(null);
    const res = await apiPost<{ activeMode?: Mode; error?: string }>("/api/auth/toggle-mode", {});
    if (!res.ok) {
      setMode(prev);
      setError((res as any).error || "Não foi possível alterar o modo.");
      window.setTimeout(() => setError(null), 3000);
      return;
    }
    const next = (res.data as any).activeMode ?? optimistic;
    setMode(next);
    startTransition(() => router.refresh());
  }

  const Icon = mode === "CONTRATANTE" ? BriefcaseIcon : UserIcon;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        onClick={toggle}
        disabled={pending || mode === "BOTH"}
        title={LABEL[mode]}
        aria-label={`Alternar modo. ${LABEL[mode]}`}
      >
        <Icon size={14} />
        <span className={styles.label}>{LABEL[mode]}</span>
      </button>
      {error && <span className={styles.error} role="status">{error}</span>}
    </div>
  );
}
