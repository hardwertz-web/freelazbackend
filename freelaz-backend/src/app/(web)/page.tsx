import { redirect } from "next/navigation";
import { getCurrentUser, hasActiveRole } from "@/lib/auth";
import { HomeScreen } from "@/components/screens/HomeScreen";

/**
 * Home: feed de vagas. O CTA de publicar é destacado no modo Contratante.
 * O FAB "Publicar vaga" só aparece para quem tem o papel Contratante ATIVO.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <HomeScreen
      canPublish={hasActiveRole(user, "CONTRATANTE")}
      activeMode={(user as any).activeMode ?? "PROFISSIONAL"}
    />
  );
}
