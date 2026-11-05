import Link from "next/link";
import styles from "./layout.module.css";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Voltar</Link>
        <span className={styles.brand}>Freelaz</span>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <Link href="/termos">Termos</Link>
        <span>·</span>
        <Link href="/privacidade">Privacidade</Link>
        <span>·</span>
        <a href="mailto:freelaz.conecta@gmail.com">Contato</a>
      </footer>
    </div>
  );
}
