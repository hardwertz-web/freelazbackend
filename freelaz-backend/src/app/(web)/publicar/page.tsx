import { redirect } from "next/navigation";
import { getCurrentUser, hasActiveRole } from "@/lib/auth";
import { PublishScreen } from "@/components/screens/PublishScreen";

/**
 * Publicar vaga (Fase 2.3c) — só para quem tem o papel Contratante ATIVO.
 * O guard é no servidor: /api/jobs também devolve 403 nesse caso, mas aqui o
 * usuário nem chega a ver o formulário.
 */
export default async function PublicarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasActiveRole(user, "CONTRATANTE")) redirect("/");
  return <PublishScreen />;
}
