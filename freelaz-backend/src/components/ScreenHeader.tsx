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
        {/* Ícone oficial (public/logo_f-96.png, 96px com alfa para retina).
            Sem wordmark/tagline — o símbolo já identifica a marca. */}
        <img src="/logo_f-96.png" alt="Freelaz" className={styles.logoImage} />
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
