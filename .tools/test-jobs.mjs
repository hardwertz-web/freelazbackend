// Testes versionados da Etapa 3.2 — AGENDADOR DE JOBS.
//
// Roda CONTRA O SERVIDOR REAL (rotas /api/jobs/*/run) com banco de dev. Nada
// aqui move dinheiro real: o repasse semanal usa PAYOUT_SANDBOX=1 (o wrapper
// .tools/test-jobs.ps1 garante). Nenhum Sandbox real do Asaas é chamado.
//
// Cobre:
//   - 401 sem token; 401 token errado; 200 token certo;
//   - idempotência OBSERVADA (rodar 2x não duplica efeito);
//   - rota de job inexistente → 404.
//
// Pré-requisitos (o .tools/test-jobs.ps1 garante):
//   - Postgres de dev no ar (porta 5432)
//   - backend em http://localhost:3000 com JOBS_RUN_TOKEN e PAYOUT_SANDBOX=1
//
// Uso: node .tools\test-jobs.mjs   (exit 0 = todos os testes passaram)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const backendDir = path.join(root, "freelaz-backend");
const require = createRequire(path.join(backendDir, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BASE = process.env.BASE_URL || "http://localhost:3000";

// ---- token de jobs lido do .env (nunca impresso) -------------------------
function readEnv(key) {
  const file = path.join(backendDir, ".env");
  if (!fs.existsSync(file)) return "";
  const line = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
}
const JOBS_TOKEN = process.env.JOBS_RUN_TOKEN || readEnv("JOBS_RUN_TOKEN");
if (!JOBS_TOKEN) {
  console.error(
    "JOBS_RUN_TOKEN ausente — defina no .env do backend (o wrapper garante um valor de teste)."
  );
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(cond, label) {
  if (cond) {
    console.log(`  OK    ${label}`);
    pass += 1;
  } else {
    console.log(`  FALHA ${label}`);
    fail += 1;
  }
}
function section(name) {
  console.log(`\n== ${name} ==`);
}

async function callJob(name, { token } = {}) {
  const headers = {};
  if (token !== undefined && token !== null) headers["x-jobs-token"] = token;
  const res = await fetch(`${BASE}/api/jobs/${name}/run`, { method: "POST", headers });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo JSON */
  }
  return { status: res.status, json };
}

// ---- dados de teste -------------------------------------------------------
const runId = Date.now().toString().slice(-6);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

async function seedContext() {
  const contractor = await prisma.user.create({
    data: {
      documentType: "CNPJ",
      document: `9${runId}0001`,
      name: "Contratante Jobs Ltda",
      email: `contratante-jobs-${runId}@exemplo.com`,
      phone: `(35) 9${runId}`,
      passwordHash: "nao-usado-nos-testes-de-job",
      roles: { create: { role: "CONTRATANTE" } },
    },
  });
  const pro = await prisma.user.create({
    data: {
      documentType: "CPF",
      document: `8${runId}0002`,
      name: "Prof Jobs",
      email: `prof-jobs-${runId}@exemplo.com`,
      phone: `(35) 8${runId}`,
      passwordHash: "nao-usado-nos-testes-de-job",
      birthDate: new Date("1990-01-01"),
      roles: { create: { role: "PROFISSIONAL" } },
      pixKey: `pix-jobs-${runId}`,
    },
  });
  return { contractor, pro };
}

async function seedJobPosting(ctx, { startsAt, endsAt }) {
  return prisma.jobPosting.create({
    data: {
      contractorId: ctx.contractor.id,
      title: `Vaga Jobs ${runId}`,
      description: "Vaga de teste do agendador de jobs (descricao suficientemente longa).",
      category: "EVENTOS",
      valueCents: 80000,
      startsAt,
      endsAt,
    },
  });
}

async function seedHiring(ctx, { status, startsAt, endsAt, openingCode = null, closingCode = null, closingCodeUsedAt = null }) {
  const jobPosting = await seedJobPosting(ctx, { startsAt, endsAt });
  const application = await prisma.application.create({
    data: { jobPostingId: jobPosting.id, professionalId: ctx.pro.id, status: "SELECIONADO", agreedValueCents: 80000 },
  });
  return prisma.hiring.create({
    data: {
      jobPostingId: jobPosting.id,
      applicationId: application.id,
      jobTitle: `Vaga Jobs ${runId}`,
      professionalId: ctx.pro.id,
      contractorId: ctx.contractor.id,
      grossValueCents: 80000,
      netValueCents: 72000,
      commissionBps: 1000,
      status,
      openingCode,
      closingCode,
      closingCodeUsedAt,
      providerPaymentId: `pay_jobs_${runId}_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
}

// ==========================================================================
async function main() {
  const ctx = await seedContext();

  // ------- 1. Autenticação -------------------------------------------------
  section("1. Autenticação por x-jobs-token");
  const noToken = await callJob("opening-codes");
  check(noToken.status === 401, `sem token → 401 (obtido ${noToken.status})`);
  const badToken = await callJob("opening-codes", { token: "token-errado-de-teste" });
  check(badToken.status === 401, `token errado → 401 (obtido ${badToken.status})`);
  const goodToken = await callJob("opening-codes", { token: JOBS_TOKEN });
  check(goodToken.status === 200, `token certo → 200 (obtido ${goodToken.status})`);
  check(goodToken.json?.ok === true, `resposta { ok: true } (${JSON.stringify(goodToken.json)})`);
  check(
    typeof goodToken.json?.processed === "number",
    `resposta traz processed numérico (${goodToken.json?.processed})`
  );

  // ------- 2. Código de ABERTURA — idempotência ----------------------------
  section("2. opening-codes: gera uma vez, 2ª execução não duplica");
  const openingHiring = await seedHiring(ctx, {
    status: "RETIDO",
    startsAt: new Date(Date.now() + HOUR), // dentro da janela 55–65min
    endsAt: new Date(Date.now() + 6 * HOUR),
  });
  const beforeOpening = await prisma.hiring.count({
    where: { id: openingHiring.id, openingCode: { not: null } },
  });
  const run1 = await callJob("opening-codes", { token: JOBS_TOKEN });
  check(run1.status === 200, `1ª execução → 200 (obtido ${run1.status})`);
  check(run1.json?.processed >= 1, `1ª execução processou ≥1 (${run1.json?.processed})`);
  const afterOpening = await prisma.hiring.count({
    where: { id: openingHiring.id, openingCode: { not: null } },
  });
  check(beforeOpening === 0 && afterOpening === 1, `código de abertura gerado (0→1, obtido ${beforeOpening}→${afterOpening})`);
  const codeAfter1 = (await prisma.hiring.findUnique({ where: { id: openingHiring.id } }))?.openingCode;

  const run2 = await callJob("opening-codes", { token: JOBS_TOKEN });
  check(run2.status === 200, `2ª execução → 200 (obtido ${run2.status})`);
  check(run2.json?.processed === 0, `2ª execução processou 0 (não duplica; obtido ${run2.json?.processed})`);
  const codeAfter2 = (await prisma.hiring.findUnique({ where: { id: openingHiring.id } }))?.openingCode;
  check(codeAfter1 === codeAfter2 && !!codeAfter2, `código NÃO foi regravado (${codeAfter1 === codeAfter2})`);

  // ------- 3. Código de FECHAMENTO — idempotência --------------------------
  section("3. closing-codes: gera uma vez, 2ª execução não duplica");
  const closingHiring = await seedHiring(ctx, {
    status: "EM_ANDAMENTO",
    startsAt: new Date(Date.now() - 4 * HOUR),
    endsAt: new Date(Date.now() + HOUR), // dentro da janela
    openingCode: "123456",
  });
  const runC1 = await callJob("closing-codes", { token: JOBS_TOKEN });
  check(runC1.status === 200, `1ª execução → 200 (obtido ${runC1.status})`);
  const cAfter1 = (await prisma.hiring.findUnique({ where: { id: closingHiring.id } }))?.closingCode;
  check(!!cAfter1, `código de fechamento gerado`);
  const runC2 = await callJob("closing-codes", { token: JOBS_TOKEN });
  check(runC2.json?.processed === 0, `2ª execução processou 0 (obtido ${runC2.json?.processed})`);
  const cAfter2 = (await prisma.hiring.findUnique({ where: { id: closingHiring.id } }))?.closingCode;
  check(cAfter1 === cAfter2, `código de fechamento NÃO foi regravado`);

  // ------- 4. Repasse semanal — idempotência -------------------------------
  section("4. weekly-payout: repassa uma vez, 2ª execução não duplica");
  const payoutHiring = await seedHiring(ctx, {
    status: "CONCLUIDO",
    startsAt: new Date(Date.now() - 8 * HOUR),
    endsAt: new Date(Date.now() - 4 * HOUR),
    openingCode: "111111",
    closingCode: "222222",
    closingCodeUsedAt: new Date(Date.now() - 3 * HOUR), // janela de 2h já passou
  });
  await prisma.ledgerEntry.create({
    data: { hiringId: payoutHiring.id, type: "RETENCAO", amountCents: 80000, reason: "payment_approved", createdBy: "system" },
  });
  const payoutsBefore = await prisma.payout.count({ where: { hiringId: payoutHiring.id, status: "CONCLUIDO" } });
  const runP1 = await callJob("weekly-payout", { token: JOBS_TOKEN });
  check(runP1.status === 200, `1ª execução → 200 (obtido ${runP1.status})`);
  check(runP1.json?.processed >= 1, `1ª execução repassou ≥1 (${runP1.json?.processed})`);
  const payoutsAfter1 = await prisma.payout.count({ where: { hiringId: payoutHiring.id, status: "CONCLUIDO" } });
  check(payoutsBefore === 0 && payoutsAfter1 === 1, `Payout CONCLUIDO criado (0→1, obtido ${payoutsBefore}→${payoutsAfter1})`);
  const libAfter1 = await prisma.ledgerEntry.count({ where: { hiringId: payoutHiring.id, type: "LIBERACAO" } });

  const runP2 = await callJob("weekly-payout", { token: JOBS_TOKEN });
  check(runP2.status === 200, `2ª execução → 200 (obtido ${runP2.status})`);
  check(runP2.json?.processed === 0, `2ª execução repassou 0 (obtido ${runP2.json?.processed})`);
  const payoutsAfter2 = await prisma.payout.count({ where: { hiringId: payoutHiring.id, status: "CONCLUIDO" } });
  const libAfter2 = await prisma.ledgerEntry.count({ where: { hiringId: payoutHiring.id, type: "LIBERACAO" } });
  check(payoutsAfter2 === 1, `continua 1 só Payout (obtido ${payoutsAfter2})`);
  check(libAfter1 === libAfter2, `nenhum LIBERACAO duplicado (${libAfter1}→${libAfter2})`);

  // ------- 5. Reconciliação diária — somente leitura -----------------------
  section("5. daily-reconciliation: somente leitura (2x sem efeito)");
  const ledBefore = await prisma.ledgerEntry.count();
  const payBefore = await prisma.payout.count();
  const rec1 = await callJob("daily-reconciliation", { token: JOBS_TOKEN });
  check(rec1.status === 200, `1ª execução → 200 (obtido ${rec1.status})`);
  check(rec1.json?.ok === true, `resposta { ok: true }`);
  check(typeof rec1.json?.report?.ok === "boolean", `relatório presente (ok=${rec1.json?.report?.ok})`);
  const rec2 = await callJob("daily-reconciliation", { token: JOBS_TOKEN });
  check(rec2.status === 200, `2ª execução → 200 (obtido ${rec2.status})`);
  const ledAfter = await prisma.ledgerEntry.count();
  const payAfter = await prisma.payout.count();
  check(ledBefore === ledAfter, `ledger inalterado (${ledBefore}→${ledAfter})`);
  check(payBefore === payAfter, `payouts inalterados (${payBefore}→${payAfter})`);

  // ------- 6. Rota de job inexistente → 404 -------------------------------
  section("6. Rota inexistente → 404");
  const missing = await callJob("nao-existe", { token: JOBS_TOKEN });
  check(missing.status === 404, `job inexistente → 404 (obtido ${missing.status})`);

  console.log(`\n=================================================`);
  console.log(`Etapa 3.2 (agendador de jobs): ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("ERRO FATAL:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
