import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BottomTabBar } from "@/components/BottomTabBar";
import { ScreenHeader } from "@/components/ScreenHeader";
import styles from "./layout.module.css";

/**
 * Casca do app autenticado (route group `(web)`): header persistente + tab bar
 * fixa de 5 itens. Sem sessão válida, toda tela daqui redireciona para /login.
 *
 * O BottomTabBar lê `useSearchParams` (para marcar "Buscar" quando a Home está
 * em modo busca) — daí o Suspense.
 */
export default async function WebLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className={styles.shell}>
      <ScreenHeader userName={user.name} />
      <main className={styles.main}>{children}</main>
      <Suspense fallback={null}>
        <BottomTabBar />
      </Suspense>
    </div>
  );
}
