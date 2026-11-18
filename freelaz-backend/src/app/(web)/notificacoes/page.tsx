import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NotificationsScreen } from "@/components/NotificationsScreen";

/** Padrão de guard das pages protegidas do app ((web)/carteira, (web)/page). */
export default async function NotificacoesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <NotificationsScreen />;
}
