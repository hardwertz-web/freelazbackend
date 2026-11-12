import Link from "next/link";
import { BellIcon } from "./Icons";
import { initials } from "@/lib/format";
import { ModeToggle } from "./ModeToggle";
import styles from "./ScreenHeader.module.css";

type ActiveMode = "PROFISSIONAL" | "CONTRATANTE" | "BOTH";

/**
 * Header persistente do app: logo, modo ativo (toggle), notificações (Fase 2)
 * e atalho para o perfil.
 */
export function ScreenHeader({ userName, activeMode }: { userName: string; activeMode?: ActiveMode }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src="/logo_f-96.png" alt="Freelaz" className={styles.logoImage} />
      </div>

      <span className={styles.spacer} />

      <ModeToggle initialMode={activeMode ?? "PROFISSIONAL"} />

      <button
        type="button"
        className={styles.iconButton}
        disabled
        title="Notificações — Fase 2"
        aria-label="Notificações (Fase 2)"
      >
        <BellIcon size={18} />
      </button>

      <Link href="/perfil" className={styles.avatar} aria-label="Abrir perfil">
        {initials(userName)}
      </Link>
    </header>
  );
}
