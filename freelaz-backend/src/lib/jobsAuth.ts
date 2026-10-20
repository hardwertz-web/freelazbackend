import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Guarda das rotas de AGENDADOR de jobs (Etapa 3.2): `/api/jobs/*\/run`.
 *
 * Separada de `checkInternalSecret` (`x-internal-secret`) DE PROPÓSITO: o
 * segredo das rotas internas também abre o painel admin, enquanto estas rotas
 * só disparam jobs periódicos. Quem vaza o token do agendador não ganha acesso
 * ao painel — e vice-versa. É um token DEDICADO (`JOBS_RUN_TOKEN`).
 *
 * Comparação em TEMPO CONSTANTE (mesmo padrão de `isValidAsaasWebhookToken`):
 * o valor recebido NUNCA é logado.
 *
 * Regras:
 *  - Token configurado: exige o cabeçalho `x-jobs-token` correto — sempre,
 *    inclusive em dev/teste (é assim que o teste exercita a trava de 401).
 *  - Token NÃO configurado e `NODE_ENV=production`: recusa (403) — em produção
 *    o agendador é obrigatório (documentado em `.env.example`).
 *  - Token NÃO configurado fora de produção: a rota responde 401 por padrão,
 *    EXCETO quando `JOBS_ALLOW_UNTOKEN=1` (escape hatch explícito para o
 *    harness local que quer exercitar só o caminho de sucesso). Nunca há
 *    caminho que contorne a validação em produção.
 *
 * Devolve `null` quando pode seguir; senão o erro HTTP pronto (401).
 */
export function checkJobsToken(
  req: NextRequest
): { status: number; body: { error: string } } | null {
  const secret = process.env.JOBS_RUN_TOKEN;
  const provided = req.headers.get("x-jobs-token");

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Sem token em produção, nem a infraestrutura pode disparar o job.
      return { status: 401, body: { error: "Não autorizado" } };
    }
    if (process.env.JOBS_ALLOW_UNTOKEN === "1") {
      console.warn(
        "[Freelaz] job aberto em dev: JOBS_RUN_TOKEN não definido e JOBS_ALLOW_UNTOKEN=1"
      );
      return null;
    }
    return { status: 401, body: { error: "Não autorizado" } };
  }

  if (!provided) return { status: 401, body: { error: "Não autorizado" } };

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return ok ? null : { status: 401, body: { error: "Não autorizado" } };
}
