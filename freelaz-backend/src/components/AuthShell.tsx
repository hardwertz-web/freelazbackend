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
          <img src="/logo_f.png" alt="Freelaz" className={styles.logoImage} />
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
