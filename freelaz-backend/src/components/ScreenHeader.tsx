import Link from "next/link";
import { BellIcon } from "./Icons";
import { initials } from "@/lib/format";
import styles from "./ScreenHeader.module.css";

/**
 * Header persistente do app: logo + tagline (identidade fixa em todas as
 * telas, como nas referências) e atalho para o perfil.
 *
 * O sino de notificações é Fase 2 — fica visível (fidelidade ao protótipo)
 * mas desabilitado, sem inventar contador de não lidas.
 */
export function ScreenHeader({ userName }: { userName: string }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        {/* Logo oficial (public/logo.jpg). O JPEG é quadrado (símbolo), então o
            wordmark "Freelaz" + tagline continuam ao lado. */}
        <img src="/logo.jpg" alt="Freelaz" className={styles.logoImage} />
        <span className={styles.brandText}>
          <span className={styles.logo}>Freelaz</span>
          <span className={styles.tagline}>Trabalho que conecta.</span>
        </span>
      </div>

      <span className={styles.spacer} />

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
