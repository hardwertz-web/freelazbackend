import Link from "next/link";
import { initials } from "@/lib/format";
import { ModeToggle } from "./ModeToggle";
import { NotificationBell } from "./NotificationBell";
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

      <NotificationBell />

      <Link href="/perfil" className={styles.avatar} aria-label="Abrir perfil">
        {initials(userName)}
      </Link>
    </header>
  );
}
