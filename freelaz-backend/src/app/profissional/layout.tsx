import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { BottomTabBar } from "@/components/BottomTabBar";
import { ScreenHeader } from "@/components/ScreenHeader";
import styles from "./layout.module.css";

/**
 * Casca do perfil público (`/profissional/[id]`). Diferente de `(web)`, aqui
 * NÃO há redirect: visitante deslogado precisa conseguir ver o perfil. Quem
 * está logado recebe o mesmo header/tab bar do app; visitante recebe um header
 * simples com o atalho para entrar.
 */
export default async function PublicProfessionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <div className={styles.shell}>
      {user ? (
        <ScreenHeader userName={user.tradeName || user.name} />
      ) : (
        <header className={styles.publicHeader}>
          <Link href="/" className={styles.brand} aria-label="Freelaz — início">
            <img src="/logo_f-96.png" alt="Freelaz" className={styles.logo} />
          </Link>
          <span className={styles.spacer} />
          <Link href="/login" className={styles.login}>
            Entrar
          </Link>
        </header>
      )}

      <main className={user ? styles.main : styles.publicMain}>{children}</main>
      {user && <BottomTabBar />}
    </div>
  );
}
