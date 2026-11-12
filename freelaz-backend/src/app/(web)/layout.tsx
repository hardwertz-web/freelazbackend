import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BottomTabBar } from "@/components/BottomTabBar";
import { ScreenHeader } from "@/components/ScreenHeader";
import styles from "./layout.module.css";

/**
 * Casca do app autenticado (route group `(web)`): header persistente + tab bar
 * fixa de 4 itens (Fase 2.4a). Sem sessão válida, toda tela daqui redireciona
 * para /login.
 */
export default async function WebLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className={styles.shell}>
      <ScreenHeader userName={user.name} activeMode={(user as any).activeMode ?? "PROFISSIONAL"} />
      <main className={styles.main}>{children}</main>
      <BottomTabBar />
    </div>
  );
}
