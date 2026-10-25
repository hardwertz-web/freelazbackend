import { redirect } from "next/navigation";
import { getCurrentUser, hasActiveRole } from "@/lib/auth";
import { HomeScreen } from "@/components/screens/HomeScreen";

/**
 * Home: o FAB "Publicar vaga" só é renderizado para quem tem o papel
 * Contratante ATIVO. `/api/auth/me` não é carregado no servidor desta rota,
 * então o papel vem direto da sessão (mesma fonte que o guard de /publicar).
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <HomeScreen canPublish={hasActiveRole(user, "CONTRATANTE")} />;
}
