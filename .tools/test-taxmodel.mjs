// Testes versionados da Etapa 7.3d - modelo de taxa "empresa paga tudo".
//
// Roda CONTRA O SERVIDOR REAL, com provedor Asaas MOCK (ver .tools/mock-asaas.mjs)
// apontado por ASAAS_API_URL. NENHUMA chamada ao Sandbox/producao e feita e
// nenhum dinheiro se move (PAYOUT_SANDBOX=1).
//
// A feature flag e lida no boot do servidor, por isso .tools/test-taxmodel.ps1
// roda este arquivo em DUAS fases:
//   TAX_MODEL_PHASE=off -> ?1 (LEGACY: net = bruto - 10%, cobranca = bruto),
//                           ?4 (releasePayout paga o liquido),
//                           ?5 (carteira disponivel = liquido)
//   TAX_MODEL_PHASE=on  -> ?2 (NEW: net = bruto, taxas, cobranca = total),
//                           ?3 (webhook NEW: RETENCAO + RECEITA_PLATAFORMA),
//                           ?4 (releasePayout paga o bruto),
//                           ?5 (carteira disponivel = bruto)
//
// Uso: node .tools\test-taxmodel.mjs   (exit 0 = todos os testes passaram)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const backendDir = path.join(root, "freelaz-backend");
const require = createRequire(path.join(backendDir, "package.json"));
const { PrismaClient } = require("@prisma/client");
const ts = require("typescript");
const prisma = new PrismaClient();

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MOCK = process.env.MOCK_ASAAS || "http://127.0.0.1:4016";
const PHASE = process.env.TAX_MODEL_PHASE || "on";
const DEV_LOG = process.env.DEV_LOG || "";

// ---- token de webhook lido do .env (nunca impresso) ----------------------
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
const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || readEnv("ASAAS_WEBHOOK_TOKEN");
const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET || readEnv("INTERNAL_API_SECRET") || "dev-secret-local";

if (!WEBHOOK_TOKEN) {
  console.error("ASAAS_WEBHOOK_TOKEN ausente - o webhook recusaria o provedor de teste.");
  process.exit(1);
}

// ---- contadores/asserts ---------------------------------------------------
let pass = 0;
let fail = 0;
const sectionStats = [];
let currentSection = null;
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
  if (currentSection) {
    currentSection.pass = pass - currentSection.pass0;
    currentSection.fail = fail - currentSection.fail0;
  }
  currentSection = { name, pass0: pass, fail0: fail, pass: 0, fail: 0 };
  sectionStats.push(currentSection);
  console.log(`\n== ${name} ==`);
}
function printSectionStats() {
  if (currentSection) {
    currentSection.pass = pass - currentSection.pass0;
    currentSection.fail = fail - currentSection.fail0;
  }
  console.log("\n---- resultado por secao ----");
  for (const s of sectionStats) {
    console.log(`  ${s.name}: ${s.pass} OK / ${s.fail} FALHA`);
  }
}

// ---- HTTP -----------------------------------------------------------------
async function api(method, pathname, { body, cookie, headers } = {}) {
  const h = { "Content-Type": "application/json", ...(headers ?? {}) };
  if (cookie) h.Cookie = cookie;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo */
  }
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const jar = setCookies.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, json, cookie: jar || cookie || null };
}

async function mockState() {
  const res = await fetch(`${MOCK}/__state`);
  if (!res.ok) throw new Error(`mock /__state HTTP ${res.status}`);
  return res.json();
}

async function mockSetPaymentStatus(id, status) {
  const res = await fetch(`${MOCK}/__scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setPaymentStatus: { id, status } }),
  });
  if (!res.ok) throw new Error(`mock /__scenario HTTP ${res.status}`);
}

function webhook(event, payment, id) {
  return api("POST", "/api/webhooks/asaas", {
    body: { id, event, payment },
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
}

// ---- funcao PURA estimateWithdrawalFeeCents ------------------------------
function loadEstimateWithdrawalFeeCents() {
  const file = path.join(backendDir, "src/lib/commission.ts");
  const src = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  if (typeof mod.exports.estimateWithdrawalFeeCents !== "function") {
    throw new Error("estimateWithdrawalFeeCents nao exportada em commission.ts");
  }
  return mod.exports.estimateWithdrawalFeeCents;
}

// ---- documentos validos por execucao (mesmo padrao das outras baterias) ---
function mod11Rest(nums, weights) {
  let sum = 0;
  for (let i = 0; i < nums.length; i++) sum += nums[i] * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}
function makeCpf(base9) {
  const b = String(base9).padStart(9, "0").slice(0, 9).split("").map(Number);
  const d1 = mod11Rest(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11Rest([...b, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${b.join("")}${d1}${d2}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}
function makeCnpj(base12) {
  const b = String(base12).padStart(12, "0").slice(0, 12).split("").map(Number);
  const d1 = mod11Rest(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11Rest([...b, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${b.join("")}${d1}${d2}`;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

// ---- montagem do cenario --------------------------------------------------
const runId = String(Date.now()).slice(-7);
const password = "senhaSegura123";
const prefix = `tax-${PHASE}-${runId}`;
let contractor = null;
let pro = null;
let contractorCookie = null;
let proCookie = null;
let counter = 0;

async function setupAccounts() {
  const cnpj = makeCnpj(`5${runId}0001`);
  const cpf = makeCpf(`${runId}31`);

  const regC = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Taxa Ltda",
      tradeName: `TAXA ${runId}`,
      email: `${prefix}-empresa@exemplo.com`,
      phone: `(35) 9${runId}`,
      password,
      roles: ["CONTRATANTE"],
      acceptedTerms: true,
    },
  });
  check(regC.status === 201, `cadastro do contratante (HTTP ${regC.status})`);

  const regP = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CPF",
      document: cpf,
      name: "Profissional Taxa",
      birthDate: "1990-03-10",
      email: `${prefix}-pro@exemplo.com`,
      phone: `(35) 8${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regP.status === 201, `cadastro do profissional (HTTP ${regP.status})`);

  const loginC = await api("POST", "/api/auth/login", {
    body: { email: `${prefix}-empresa@exemplo.com`, password },
  });
  contractorCookie = loginC.cookie;
  check(loginC.status === 200 && !!contractorCookie, `login contratante (HTTP ${loginC.status})`);

  const loginP = await api("POST", "/api/auth/login", {
    body: { email: `${prefix}-pro@exemplo.com`, password },
  });
  proCookie = loginP.cookie;
  check(loginP.status === 200 && !!proCookie, `login profissional (HTTP ${loginP.status})`);

  contractor = await prisma.user.findUnique({ where: { email: `${prefix}-empresa@exemplo.com` } });
  pro = await prisma.user.findUnique({ where: { email: `${prefix}-pro@exemplo.com` } });
  check(!!contractor && !!pro, "usuarios existem no banco");
  if (!contractor || !pro) throw new Error("contas nao criadas");

  await prisma.userRoleAssignment.updateMany({
    where: { userId: { in: [contractor.id, pro.id] } },
    data: { status: "ATIVO" },
  });
  const active = await prisma.userRoleAssignment.count({
    where: { userId: { in: [contractor.id, pro.id] }, status: "ATIVO" },
  });
  check(active >= 2, `papeis ativados no banco (${active})`);

  // Necessario para o repasse (sandbox) sair.
  await prisma.user.update({ where: { id: pro.id }, data: { pixKey: "tax-teste@pix.local" } });
}

async function newJob(grossValueCents, title) {
  const res = await api("POST", "/api/jobs", {
    cookie: contractorCookie,
    body: {
      title,
      description: "Vaga de teste do modelo de taxa com descricao suficientemente longa.",
      category: "EVENTOS",
      valueCents: grossValueCents,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  if (res.status !== 201) {
    throw new Error(`criar vaga falhou: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json.jobPosting.id;
}

/** Cria a contratacao pelo fluxo REAL (selectCandidate -> createHiringForApplication). */
async function hiringViaSelect(grossValueCents) {
  counter += 1;
  const title = `Vaga Taxa ${runId}-${counter}`;
  const jobPostingId = await newJob(grossValueCents, title);
  const application = await prisma.application.create({
    data: {
      jobPostingId,
      professionalId: pro.id,
      status: "PENDENTE",
      agreedValueCents: grossValueCents,
    },
  });
  const selected = await api("POST", `/api/jobs/${jobPostingId}/select`, {
    cookie: contractorCookie,
    body: { applicationId: application.id },
  });
  if (selected.status !== 200) {
    throw new Error(`selecionar candidato falhou: HTTP ${selected.status} ${JSON.stringify(selected.json)}`);
  }
  return prisma.hiring.findUnique({ where: { applicationId: application.id } });
}

/** Criacao direta (somente para a carteira, sem passar por cobranca/repasse). */
async function directHiring({ grossValueCents, netValueCents, taxModel, fees = {} }) {
  counter += 1;
  const title = `Vaga Carteira ${runId}-${counter}`;
  const jobPostingId = await newJob(grossValueCents, title);
  const application = await prisma.application.create({
    data: {
      jobPostingId,
      professionalId: pro.id,
      status: "SELECIONADO",
      agreedValueCents: grossValueCents,
    },
  });
  return prisma.hiring.create({
    data: {
      jobPostingId,
      applicationId: application.id,
      jobTitle: title,
      professionalId: pro.id,
      contractorId: contractor.id,
      grossValueCents,
      netValueCents,
      commissionBps: 1000,
      taxModel,
      serviceFeeCents: fees.serviceFeeCents ?? null,
      estimatedWithdrawalFeeCents: fees.estimatedWithdrawalFeeCents ?? null,
      totalChargedCents: fees.totalChargedCents ?? null,
      status: "CONCLUIDO",
    },
  });
}

async function charge(hiringId) {
  const res = await api("POST", "/api/payments/create", {
    cookie: contractorCookie,
    body: { hiringId },
  });
  return res;
}

async function release(hiringId) {
  return api("POST", "/api/payouts/release", {
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: { hiringId },
  });
}

async function markConcluded(hiringId) {
  return prisma.hiring.update({
    where: { id: hiringId },
    data: {
      status: "CONCLUIDO",
      closingCodeUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
  });
}

// ==========================================================================
async function phaseOff() {
  await setupAccounts();

  section("?1. Flag OFF -> LEGACY (net = bruto*0.9, cobranca = bruto)");
  const h1 = await hiringViaSelect(80000);
  if (!h1) throw new Error("contratacao LEGACY nao criada");
  check(h1.taxModel === "LEGACY", `taxModel = ${h1.taxModel}`);
  check(h1.grossValueCents === 80000, `gross = ${h1.grossValueCents}`);
  check(h1.netValueCents === 72000, `net = bruto*0.9 = ${h1.netValueCents}`);
  check(h1.serviceFeeCents === null, `serviceFeeCents = ${h1.serviceFeeCents}`);
  check(h1.estimatedWithdrawalFeeCents === null, `estimatedWithdrawalFeeCents = ${h1.estimatedWithdrawalFeeCents}`);
  check(h1.totalChargedCents === null, `totalChargedCents = ${h1.totalChargedCents}`);

  const c1 = await charge(h1.id);
  check(c1.status === 200, `POST /api/payments/create -> HTTP ${c1.status}`);
  const state1 = await mockState();
  const pay1 = state1.payments.find((p) => p.id === c1.json?.paymentId);
  check(!!pay1, "cobranca encontrada no mock");
  check(pay1?.value === 800, `cobranca = bruto (R$ ${pay1?.value})`);
  check(pay1?.split === null, "sem split (subcontas off)");

  section("?4. LEGACY: releasePayout transfere o liquido");
  const h1b = await prisma.hiring.findUnique({ where: { id: h1.id } });
  const paid1 = await markConcluded(h1.id);
  check(paid1.status === "CONCLUIDO", "contratacao marcada CONCLUIDA para o repasse");
  check(!!h1b?.providerPaymentId, "cobranca registrada no Hiring");
  const r1 = await release(h1.id);
  check(r1.status === 200, `POST /api/payouts/release -> HTTP ${r1.status}`);
  const payout1 = await prisma.payout.findUnique({ where: { hiringId: h1.id } });
  check(payout1?.status === "CONCLUIDO", `payout status = ${payout1?.status}`);
  check(payout1?.amountCents === 72000, `payout LEGACY = liquido (${payout1?.amountCents})`);

  section("?5. LEGACY: carteira disponivel = liquido");
  const walletHiring1 = await directHiring({
    grossValueCents: 50000,
    netValueCents: 45000,
    taxModel: "LEGACY",
  });
  const wallet1 = await api("GET", "/api/wallet?limit=5", { cookie: proCookie });
  check(wallet1.status === 200, `GET /api/wallet -> HTTP ${wallet1.status}`);
  check(
    wallet1.json?.wallet?.disponivelCents === 45000,
    `disponivelCents LEGACY = liquido (${wallet1.json?.wallet?.disponivelCents})`
  );
  check(walletHiring1.taxModel === "LEGACY", "contratacao da carteira e LEGACY");
}

async function phaseOn() {
  await setupAccounts();

  section("?2. Flag ON -> NEW (net = bruto, taxas, cobranca = total)");
  const estimate = loadEstimateWithdrawalFeeCents();
  check(estimate(10000) === 8, `estimate(10000) = ${estimate(10000)}`);
  check(estimate(25000) === 8, `estimate(25000) = ${estimate(25000)}`);
  check(estimate(25001) === 200, `estimate(25001) = ${estimate(25001)}`);
  check(estimate(100000) === 200, `estimate(100000) = ${estimate(100000)}`);

  const h2 = await hiringViaSelect(80000);
  if (!h2) throw new Error("contratacao NEW nao criada");
  check(h2.taxModel === "NEW", `taxModel = ${h2.taxModel}`);
  check(h2.grossValueCents === 80000, `gross = ${h2.grossValueCents}`);
  check(h2.netValueCents === 80000, `net = bruto (${h2.netValueCents})`);
  check(h2.serviceFeeCents === 8000, `serviceFee = 10% (${h2.serviceFeeCents})`);
  check(h2.estimatedWithdrawalFeeCents === 200, `estimatedWithdrawal = ${h2.estimatedWithdrawalFeeCents}`);
  check(h2.totalChargedCents === 88200, `total = bruto + taxas (${h2.totalChargedCents})`);

  const c2 = await charge(h2.id);
  check(c2.status === 200, `POST /api/payments/create -> HTTP ${c2.status}`);
  const state2 = await mockState();
  const pay2 = state2.payments.find((p) => p.id === c2.json?.paymentId);
  check(!!pay2, "cobranca encontrada no mock");
  check(pay2?.value === 882, `cobranca NEW = total (R$ ${pay2?.value})`);
  check(pay2?.split === null, "sem split (subcontas off)");

  section("?3. Webhook NEW -> RETENCAO + RECEITA_PLATAFORMA");
  const charged2 = await prisma.hiring.findUnique({ where: { id: h2.id } });
  if (!charged2?.providerPaymentId) throw new Error("providerPaymentId ausente na cobranca NEW");
  await mockSetPaymentStatus(charged2.providerPaymentId, "CONFIRMED");
  const wh = await webhook(
    "PAYMENT_CONFIRMED",
    {
      id: charged2.providerPaymentId,
      status: "CONFIRMED",
      value: 882,
      externalReference: h2.id,
      dateCreated: new Date().toISOString(),
    },
    `evt_tax_${h2.id}`
  );
  check(wh.status === 200, `webhook PAYMENT_CONFIRMED -> HTTP ${wh.status}`);
  const afterWebhook = await prisma.hiring.findUnique({ where: { id: h2.id } });
  check(afterWebhook?.status === "RETIDO", `status apos webhook = ${afterWebhook?.status}`);

  const entries = await prisma.ledgerEntry.findMany({
    where: { hiringId: h2.id },
    orderBy: { type: "asc" },
  });
  check(entries.length === 2, `lancamentos = 2 (${entries.length})`);
  const retention = entries.find((e) => e.type === "RETENCAO");
  const revenue = entries.find((e) => e.type === "RECEITA_PLATAFORMA");
  check(retention?.amountCents === 80000, `RETENCAO = bruto (${retention?.amountCents})`);
  check(revenue?.amountCents === 8200, `RECEITA_PLATAFORMA = taxas (${revenue?.amountCents})`);

  section("?4. NEW: releasePayout transfere o bruto");
  await markConcluded(h2.id);
  const r2 = await release(h2.id);
  check(r2.status === 200, `POST /api/payouts/release -> HTTP ${r2.status}`);
  const payout2 = await prisma.payout.findUnique({ where: { hiringId: h2.id } });
  check(payout2?.status === "CONCLUIDO", `payout status = ${payout2?.status}`);
  check(payout2?.amountCents === 80000, `payout NEW = bruto (${payout2?.amountCents})`);

  section("?5. NEW: carteira disponivel = bruto");
  const walletHiring2 = await directHiring({
    grossValueCents: 50000,
    netValueCents: 50000,
    taxModel: "NEW",
    fees: { serviceFeeCents: 5000, estimatedWithdrawalFeeCents: 200, totalChargedCents: 55200 },
  });
  const wallet2 = await api("GET", "/api/wallet?limit=5", { cookie: proCookie });
  check(wallet2.status === 200, `GET /api/wallet -> HTTP ${wallet2.status}`);
  check(
    wallet2.json?.wallet?.disponivelCents === 50000,
    `disponivelCents NEW = bruto (${wallet2.json?.wallet?.disponivelCents})`
  );
  check(walletHiring2.taxModel === "NEW", "contratacao da carteira e NEW");
}

// ==========================================================================
async function main() {
  if (PHASE === "off") {
    await phaseOff();
  } else if (PHASE === "on") {
    await phaseOn();
  } else {
    throw new Error(`TAX_MODEL_PHASE invalida: ${PHASE}`);
  }

  printSectionStats();
  console.log(`\nRESULTADO (${PHASE}): ${pass} OK / ${fail} FALHA`);
  if (DEV_LOG && fs.existsSync(DEV_LOG)) {
    const log = fs.readFileSync(DEV_LOG, "utf8");
    check(!/incomeValueCents|apiKey|walletId/.test(log), "log do dev server sem dados sensiveis");
  }
}

main()
  .catch((err) => {
    console.error("ERRO FATAL:", err);
    fail += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
