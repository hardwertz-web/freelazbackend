// Etapa 3.2 — dispara os jobs agendados via HTTP (localhost).
//
// Cada job tem sua rota POST /api/jobs/<nome>/run, protegida pelo cabeçalho
// `x-jobs-token` (JOBS_RUN_TOKEN — ver jobsAuth.ts). Este script lê o token do
// `.env` do backend SEM IMPRIMIR o valor e chama as rotas em sequência (ou só
// uma, com `--job=<nome>`).
//
// Uso:
//   node .tools\run-jobs.mjs                     # roda todos, na ordem
//   node .tools\run-jobs.mjs --job=opening-codes # roda só um
//   node .tools\run-jobs.mjs --base=http://127.0.0.1:3000
//
// NÃO usa `Tee-Object` (trava com o dev server na nota do projeto) — escreve
// direto no stdout. NUNCA imprime o token; imprime só status e o resumo do job.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const backendDir = path.join(root, "freelaz-backend");

// ---------- .env do backend (mesma leitura dos outros scripts) -------------
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim().replace(/\\\$/g, "$");
  }
  return out;
}
const envFile = readEnvFile(path.join(backendDir, ".env"));
const TOKEN = process.env.JOBS_RUN_TOKEN || envFile.JOBS_RUN_TOKEN || "";
const ALLOW_UNTOKEN = process.env.JOBS_ALLOW_UNTOKEN || envFile.JOBS_ALLOW_UNTOKEN || "";

// ---------- argumentos -----------------------------------------------------
const JOBS = ["opening-codes", "closing-codes", "weekly-payout", "daily-reconciliation"];
let base = "http://127.0.0.1:3000";
let only = null;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--base=")) base = arg.slice("--base=".length).replace(/\/$/, "");
  else if (arg.startsWith("--job=")) only = arg.slice("--job=".length);
}
if (only && !JOBS.includes(only)) {
  console.error(`Job desconhecido: ${only}. Válidos: ${JOBS.join(", ")}`);
  process.exit(2);
}
const selected = only ? [only] : JOBS;

// ---------- chamada --------------------------------------------------------
async function runJob(name) {
  const url = `${base}/api/jobs/${name}/run`;
  const headers = TOKEN ? { "x-jobs-token": TOKEN } : {};
  let res;
  try {
    res = await fetch(url, { method: "POST", headers });
  } catch (err) {
    console.log(`  ${name}: FALHA de rede — ${err instanceof Error ? err.message : err}`);
    return { name, ok: false, status: 0 };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* sem corpo JSON */
  }
  const ok = res.status === 200 && body?.ok === true;
  const summary =
    body?.ok === true
      ? `processed=${body.processed}` + (body.failed?.length ? ` failed=${body.failed.length}` : "")
      : body?.error
        ? `error=${body.error}`
        : "";
  console.log(`  ${name}: HTTP ${res.status} ${ok ? "OK" : "NAO-OK"} ${summary}`.trimEnd());
  if (body?.report?.discrepancies?.length) {
    for (const d of body.report.discrepancies) console.log(`      DIVERGENCIA: ${d}`);
  }
  return { name, ok, status: res.status };
}

async function main() {
  console.log(`Disparando jobs em ${base}`);
  if (!TOKEN) {
    console.log(
      ALLOW_UNTOKEN === "1"
        ? "  (JOBS_RUN_TOKEN vazio; JOBS_ALLOW_UNTOKEN=1 — rotas abertas em dev)"
        : "  (JOBS_RUN_TOKEN vazio — as rotas devem responder 401)"
    );
  }
  const results = [];
  for (const name of selected) results.push(await runJob(name));

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} job(s) OK`);
  process.exit(okCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("ERRO FATAL:", err);
  process.exit(1);
});
