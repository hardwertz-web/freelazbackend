/**
 * Startup do servidor (Next instrumentation hook — Etapa 3.3).
 *
 * Roda quando o runtime do servidor sobe, antes de atender requisições. Aqui
 * ficam as verificações de configuração que devem IMPEDIR o app de subir num
 * estado perigoso — melhor não subir do que subir inseguro.
 *
 * Este hook roda também no runtime Edge (bundled), então importamos SOMENTE
 * `jobsStartup` (lógica pura, sem `crypto`/`next/server`). A checagem só faz
 * sentido no runtime Node, onde as variáveis de ambiente do servidor valem.
 *
 * Verificação: `assertJobsAllowUntokenSafe` proíbe `NODE_ENV=production` com
 * `JOBS_ALLOW_UNTOKEN=1` (o escape hatch de dev abriria as rotas de job,
 * inclusive o repasse semanal, sem token). Não imprime segredo algum.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertJobsAllowUntokenSafe } = await import("./lib/jobsStartup");
  assertJobsAllowUntokenSafe();
}
