import styles from "./AuthShell.module.css";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

/**
 * Casca das telas de entrada (login/cadastro): sem tab bar, cartão central
 * com a mesma linguagem visual do app (azul, cantos arredondados, Poppins).
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            f
          </span>
          <span className={styles.brandText}>
            <span className={styles.logo}>Freelaz</span>
            <span className={styles.tagline}>Trabalho que conecta.</span>
          </span>
        </div>

        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {children}

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

export { styles as authStyles };
