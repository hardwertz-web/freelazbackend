import type { NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "./auth";

/**
 * Guarda das rotas internas — os agendadores (cron) e a liberação de repasse.
 *
 * A Governança Financeira (ver findings.md) proíbe que dinheiro se mova por
 * ação manual livre. Quem chama um agendador não é um usuário logado: é a
 * própria infraestrutura do Freelaz. Por isso a autenticação é um segredo
 * compartilhado (header `x-internal-secret`), não uma sessão de conta.
 *
 * Em produção o segredo é OBRIGATÓRIO — sem ele a rota recusa tudo. Em
 * desenvolvimento, se o segredo estiver configurado ele é cobrado mesmo
 * (assim o teste consegue exercitar a trava); sem segredo configurado em dev,
 * a rota fica livre com aviso no console. Devolve `null` quando pode seguir,
 * ou o erro HTTP pronto.
 */
export function checkInternalSecret(
  req: NextRequest
): { status: number; body: { error: string } } | null {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = req.headers.get("x-internal-secret") ?? "";

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Sem segredo em produção, nem o próprio servidor pode chamar.
      return { status: 403, body: { error: "Não autorizado" } };
    }
    console.warn(
      "[Freelaz] rota interna aberta em dev: defina INTERNAL_API_SECRET no .env"
    );
    return null;
  }

  if (provided !== secret) {
    return { status: 403, body: { error: "Não autorizado" } };
  }
  return null;
}

// ----- Painel administrativo (Fase 5) -----

export type AdminAccess =
  | { granted: true; via: "secret" | "session"; userId: string | null }
  | { granted: false; error: { status: number; body: { error: string } } };

/**
 * Guarda das rotas `/api/admin/*` do painel — aceita DOIS caminhos, nenhum
 * fraco:
 *
 * 1. O segredo interno (`x-internal-secret`), como sempre — é o caminho da
 *    infraestrutura e dos testes, e o comportamento dele não muda em nada
 *    (segredo errado continua 403 na hora, sem tentar sessão).
 * 2. Sessão de conta com papel ADMIN ativo — é o caminho do painel no
 *    navegador, onde o segredo não pode aparecer (ficaria no bundle do
 *    cliente). Quando a autenticação vem da sessão, o `adminId` auditado nas
 *    decisões é o id do usuário da sessão — não uma string declarada no corpo.
 *
 * Diferença em relação às rotas de cron: o painel NUNCA fica aberto em dev
 * sem segredo configurado — admin é sessão ADMIN ou nada. Em produção sem
 * segredo configurado a rota recusa tudo (regra do `checkInternalSecret`
 * preservada).
 */
export async function checkAdminAccess(
  req: NextRequest
): Promise<AdminAccess> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) {
    const provided = req.headers.get("x-internal-secret") ?? "";
    if (provided === secret) {
      return { granted: true, via: "secret", userId: null };
    }
    if (provided !== "") {
      return { granted: false, error: { status: 403, body: { error: "Não autorizado" } } };
    }
    // Sem header: tenta a sessão ADMIN logo abaixo.
  } else if (process.env.NODE_ENV === "production") {
    return { granted: false, error: { status: 403, body: { error: "Não autorizado" } } };
  }

  const user = await getCurrentUser();
  if (isAdmin(user)) {
    return { granted: true, via: "session", userId: user!.id };
  }
  return { granted: false, error: { status: 403, body: { error: "Não autorizado" } } };
}
