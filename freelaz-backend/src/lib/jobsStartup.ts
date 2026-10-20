/**
 * Checagens de STARTUP dos jobs (Etapa 3.3) — SEM dependências Node-only.
 *
 * Vive num módulo PRÓPRIO (sem `crypto`, sem `next/server`) DE PROPÓSITO: é
 * importado por `src/instrumentation.ts`, que o Next pode bundle-ar para o
 * runtime Edge, onde módulos Node como `crypto` não resolvem. Aqui só há
 * lógica pura sobre variáveis de ambiente.
 */

/**
 * Validação PURA do escape hatch `JOBS_ALLOW_UNTOKEN`.
 *
 * O escape hatch existe só para o harness local exercitar o caminho de sucesso
 * sem token. Em PRODUÇÃO ele é um risco: abriria os jobs de dinheiro (repasse
 * semanal) para qualquer um. Por isso a combinação
 * `NODE_ENV=production` + `JOBS_ALLOW_UNTOKEN=1` é **proibida**.
 *
 * Recebe os dois valores e responde — permite testar o caso "produção" em dev
 * sem subir o app com `NODE_ENV=production`.
 *
 * Devolve `true` quando a combinação é **proibida** (deve lançar).
 */
export function isUntokenJobsForbidden(
  nodeEnv: string | undefined,
  allowUntoken: string | undefined
): boolean {
  return nodeEnv === "production" && allowUntoken === "1";
}

/**
 * Verificação de STARTUP: lança se a combinação proibida estiver presente.
 * Melhor não subir do que subir com os jobs de dinheiro abertos.
 * Nunca imprime o valor de `JOBS_ALLOW_UNTOKEN` (só o nome da variável).
 */
export function assertJobsAllowUntokenSafe(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  allowUntoken: string | undefined = process.env.JOBS_ALLOW_UNTOKEN
): void {
  if (isUntokenJobsForbidden(nodeEnv, allowUntoken)) {
    throw new Error(
      "JOBS_ALLOW_UNTOKEN é proibido em produção: ele abriria as rotas /api/jobs/*/run " +
        "(inclusive o repasse semanal) sem token. Remova JOBS_ALLOW_UNTOKEN (ou defina " +
        "JOBS_RUN_TOKEN) e suba novamente."
    );
  }
}
