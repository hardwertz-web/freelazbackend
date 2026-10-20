// Testes da Etapa 1 — idempotência de cobrança (correção autorizada).
//
// Roda CONTRA O SERVIDOR REAL (rotas /api/payments/create e /api/jobs/boost)
// com um provedor Asaas MOCK (ver .tools/mock-asaas.mjs) apontado por
// ASAAS_API_URL. Nada aqui move dinheiro real nem usa credencial de produção.
//
// Pré-requisitos (o .tools/test-idempotencia.ps1 garante):
//   - backend em http://localhost:3000 com
//       ASAAS_API_KEY=<chave-de-mock>  e  ASAAS_API_URL=http://127.0.0.1:4010/v3
//   - mock em http://127.0.0.1:4010
//
// Uso: node .tools\test-idempotencia.mjs   (exit 0 = todos os testes passaram)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const backendDir = path.join(root, "freelaz-backend");
const require = createRequire(path.join(backendDir, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010";

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

// ---------- helpers -------------------------------------------------------

async function mockScenario(patch) {
  const res = await fetch(`${MOCK}/__scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`mock /__scenario HTTP ${res.status}`);
}
async function mockState() {
  const res = await fetch(`${MOCK}/__state`);
  return res.json();
}
async function mockReset() {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
}

async function api(method, pathname, { body, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const jar = setCookies.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo JSON */
  }
  return { status: res.status, json, cookie: jar || cookie || null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CPF/CNPJ com dígitos verificadores válidos -------------------
// O /api/auth/register valida os dígitos (lib de documentos); geramos documentos
// válidos e ÚNICOS por execução a partir do runId.
function mod11Rest(nums, weights) {
  let sum = 0;
  for (let i = 0; i < nums.length; i++) sum += nums[i] * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}
function makeCpf(base9Digits) {
  const b = base9Digits.split("").map(Number);
  const d1 = mod11Rest(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11Rest([...b, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${base9Digits}${d1}${d2}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}
function makeCnpj(base12Digits) {
  const b = base12Digits.split("").map(Number);
  const d1 = mod11Rest(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11Rest([...b, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${base12Digits}${d1}${d2}`;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

// ---------- montagem do cenário ------------------------------------------

const runId = String(Date.now()).slice(-7);
const contractorEmail = `idem-empresa-${runId}@exemplo.com`;
const proEmail = `idem-pro-${runId}@exemplo.com`;
const password = "senhaSegura123";

let contractorCookie = null;
let contractor = null;
let pro = null;

async function setupAccounts() {
  const cnpj = makeCnpj(`8${runId}0001`);
  const cpf = makeCpf(`${runId}11`);
  const reg = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Idempotencia Ltda",
      tradeName: `Idem ${runId}`,
      email: contractorEmail,
      phone: `(35) 9${runId}`,
      password,
      roles: ["CONTRATANTE"],
      acceptedTerms: true,
    },
  });
  check(
    reg.status === 201,
    `cadastro do contratante (HTTP ${reg.status}${reg.status === 201 ? "" : `: ${JSON.stringify(reg.json)}`})`
  );

  const regPro = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CPF",
      document: cpf,
      name: "Profissional Idempotencia",
      birthDate: "1993-04-10",
      email: proEmail,
      phone: `(35) 8${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(
    regPro.status === 201,
    `cadastro do profissional (HTTP ${regPro.status}${regPro.status === 201 ? "" : `: ${JSON.stringify(regPro.json)}`})`
  );

  const login = await api("POST", "/api/auth/login", { body: { email: contractorEmail, password } });
  contractorCookie = login.cookie;
  check(login.status === 200 && !!contractorCookie, `login do contratante (HTTP ${login.status})`);

  contractor = await prisma.user.findUnique({ where: { email: contractorEmail } });
  pro = await prisma.user.findUnique({ where: { email: proEmail } });
  check(!!contractor && !!pro, "usuários existem no banco");
}

async function newJob(title) {
  const res = await api("POST", "/api/jobs", {
    cookie: contractorCookie,
    body: {
      title,
      description: "Vaga de teste de idempotencia com descricao suficientemente longa.",
      category: "EVENTOS",
      valueCents: 80000,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  if (res.status !== 201) throw new Error(`criar vaga falhou: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.jobPosting.id;
}

async function newHiring(jobPostingId, jobTitle) {
  const application = await prisma.application.create({
    data: { jobPostingId, professionalId: pro.id, status: "SELECIONADO", agreedValueCents: 80000 },
  });
  return prisma.hiring.create({
    data: {
      jobPostingId,
      applicationId: application.id,
      jobTitle,
      professionalId: pro.id,
      contractorId: contractor.id,
      grossValueCents: 80000,
      netValueCents: 72000,
      commissionBps: 1000,
      status: "AGUARDANDO_PAGAMENTO",
    },
  });
}

const createCharge = (hiringId) =>
  api("POST", "/api/payments/create", { cookie: contractorCookie, body: { hiringId } });
const boostCharge = (jobPostingId) =>
  api("POST", "/api/jobs/boost", { cookie: contractorCookie, body: { jobPostingId } });

const attemptsOf = (entity, entityId) =>
  prisma.chargeAttempt.findMany({ where: { entity, entityId }, orderBy: { attempt: "asc" } });

// ==========================================================================
async function main() {
  await mockReset();
  await setupAccounts();

  // Snapshot de preservação financeira/histórica (teste 8) — comparado no fim.
  const snapshot = async () => ({
    ledger: (await prisma.ledgerEntry.findMany({ select: { id: true, type: true, hiringId: true } }))
      .map((r) => JSON.stringify(r))
      .sort(),
    hirings: (await prisma.hiring.findMany({ select: { id: true, status: true } }))
      .map((r) => JSON.stringify(r))
      .sort(),
    payouts: (await prisma.payout.findMany({ select: { id: true, status: true } }))
      .map((r) => JSON.stringify(r))
      .sort(),
  });
  const before = await snapshot();

  // ---------- 1) Retry após resposta perdida do provedor ------------------
  section("1. Resposta perdida do provedor (criou, mas não respondeu)");
  {
    const job = await newJob("Vaga Resposta Perdida");
    const hiring = await newHiring(job, "Resposta Perdida");
    await mockScenario({ createMode: "drop", createDelayMs: 0 });

    const first = await createCharge(hiring.id);
    check(first.status === 503, `1a. retorno ambíguo vira 503 (obtido ${first.status})`);
    const s1 = await mockState();
    check(s1.calls.create === 1, `1b. provedor criou exatamente 1 cobrança (${s1.calls.create})`);
    const afterFirst = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(afterFirst.providerPaymentId === null, "1c. id do provedor NÃO foi gravado sem resposta");
    const att1 = await attemptsOf("HIRING", hiring.id);
    check(
      att1.length === 1 && att1[0].state === "PROVIDER_UNCONFIRMED",
      `1d. tentativa 1 fica AMBÍGUA (states: ${att1.map((a) => a.state).join(",")})`
    );

    await mockScenario({ createMode: "ok" });
    const second = await createCharge(hiring.id);
    check(second.status === 200 && second.json?.alreadyCreated === true, `1e. retry adota a cobrança (HTTP ${second.status}, alreadyCreated=${second.json?.alreadyCreated})`);
    const s2 = await mockState();
    check(s2.calls.create === 1, `1f. NENHUMA cobrança nova no retry (${s2.calls.create} criações)`);
    const afterSecond = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(!!afterSecond.providerPaymentId, "1g. id do provedor gravado na adoção");
    check(second.json?.paymentId === afterSecond.providerPaymentId, "1h. resposta e banco apontam o mesmo pagamento");
  }

  // ---------- 2) Falha ao persistir providerPaymentId ---------------------
  section("2. Falha ao persistir o id do provedor (violação de unicidade)");
  {
    const job = await newJob("Vaga Persistencia");
    const hiring = await newHiring(job, "Persistencia");
    const other = await newHiring(await newJob("Vaga Conflito"), "Conflito");
    // Outra contratação já usa esse id no banco -> gravar o mesmo id aqui falha.
    const conflictId = `pay_conflict_${runId}`;
    await prisma.hiring.update({
      where: { id: other.id },
      data: { providerPaymentId: conflictId },
    });
    await mockScenario({ createMode: "forced_id", forcedId: conflictId });
    const before2 = (await mockState()).calls.create;

    const first = await createCharge(hiring.id);
    check(first.status === 503, `2a. falha de persistência vira 503 sem derrubar (obtido ${first.status})`);
    const s1 = await mockState();
    check(s1.calls.create === before2 + 1, `2b. provedor criou exatamente 1 cobrança nesta tentativa (${s1.calls.create - before2})`);
    const h1 = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(h1.providerPaymentId === null, "2c. alvo não guarda id inválido/duplicado");
    const att = await attemptsOf("HIRING", hiring.id);
    check(
      att.some((a) => a.state === "CONFIRMED" && a.providerPaymentId === conflictId),
      "2d. a tentativa registra o id criado (nada se perde)"
    );

    // Libera o conflito: a próxima reconciliação deve ADOTAR a cobrança.
    await prisma.hiring.update({ where: { id: other.id }, data: { providerPaymentId: null } });
    await mockScenario({ createMode: "ok", forcedId: null });
    const second = await createCharge(hiring.id);
    check(second.status === 200 && second.json?.paymentId === conflictId, `2e. retry adota a cobrança existente (HTTP ${second.status}, id=${second.json?.paymentId})`);
    const s2 = await mockState();
    check(s2.calls.create === before2 + 1, `2f. nenhuma cobrança duplicada na recuperação (${s2.calls.create - before2} criação(ões))`);
  }

  // ---------- 3) Duas requisições simultâneas — mesma contratação ---------
  section("3. Duas requisições simultâneas para a mesma contratação");
  for (let round = 1; round <= 3; round++) {
    const job = await newJob(`Vaga Concorrencia Hiring ${round}`);
    const hiring = await newHiring(job, `Concorrencia Hiring ${round}`);
    const before3 = (await mockState()).calls.create;
    await mockScenario({ createMode: "ok", createDelayMs: 1200 });

    const [r1, r2] = await Promise.all([createCharge(hiring.id), createCharge(hiring.id)]);
    await mockScenario({ createDelayMs: 0 });

    const s = await mockState();
    check(s.calls.create === before3 + 1, `3a.r${round}. exatamente UMA criação no provedor (${s.calls.create - before3})`);
    const codes = [r1.status, r2.status].sort();
    for (const r of [r1, r2]) {
      if (r.status !== 200 && r.status !== 409) {
        console.log(`        [diagnóstico 3b.r${round}] HTTP ${r.status}: ${JSON.stringify(r.json)}`);
      }
    }
    check(codes.every((c) => c === 200 || c === 409), `3b.r${round}. respostas apenas 200/409 (obtidas: ${codes.join(",")})`);
    check(codes.includes(200), `3c.r${round}. ao menos uma requisição recebeu a cobrança`);
    const h = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    const payments = (await mockState()).payments.filter((p) => p.externalReference === hiring.id);
    check(
      !!h.providerPaymentId && payments.length === 1 && payments[0].id === h.providerPaymentId,
      `3d.r${round}. banco e provedor convergem em uma única cobrança`
    );
    const att = await attemptsOf("HIRING", hiring.id);
    check(
      att.filter((a) => a.state === "CONFIRMED").length === 1,
      `3e.r${round}. uma única tentativa confirmada (${att.map((a) => `${a.attempt}:${a.state}`).join(" ")})`
    );
  }

  // ---------- 4) Duas requisições simultâneas — mesmo boost ---------------
  section("4. Duas requisições simultâneas para o mesmo boost");
  for (let round = 1; round <= 3; round++) {
    const job = await newJob(`Vaga Concorrencia Boost ${round}`);
    const before4 = (await mockState()).calls.create;
    await mockScenario({ createMode: "ok", createDelayMs: 1200 });

    const [r1, r2] = await Promise.all([boostCharge(job), boostCharge(job)]);
    await mockScenario({ createDelayMs: 0 });

    const s = await mockState();
    check(s.calls.create === before4 + 1, `4a.r${round}. exatamente UMA criação no provedor (${s.calls.create - before4})`);
    const boosts = await prisma.jobBoost.findMany({ where: { jobPostingId: job } });
    check(boosts.length === 1, `4b.r${round}. um único registro de boost no banco (${boosts.length})`);
    const codes = [r1.status, r2.status].sort();
    for (const r of [r1, r2]) {
      if (r.status !== 200 && r.status !== 409) {
        console.log(`        [diagnóstico 4c.r${round}] HTTP ${r.status}: ${JSON.stringify(r.json)}`);
      }
    }
    check(codes.every((c) => c === 200 || c === 409), `4c.r${round}. respostas apenas 200/409 (obtidas: ${codes.join(",")})`);
    check(codes.includes(200), `4d.r${round}. ao menos uma requisição recebeu a cobrança`);
    const payments = (await mockState()).payments.filter((p) => p.externalReference === `boost:${boosts[0].id}`);
    check(
      payments.length === 1 && payments[0].id === boosts[0].providerPaymentId,
      `4e.r${round}. banco e provedor convergem em uma única cobrança`
    );
  }

  // ---------- 5) Repetição da mesma tentativa sem duplicar ----------------
  section("5. Repetição sequencial da mesma chamada");
  {
    const job = await newJob("Vaga Repeticao");
    const hiring = await newHiring(job, "Repeticao");
    const before5 = (await mockState()).calls.create;

    const r1 = await createCharge(hiring.id);
    const r2 = await createCharge(hiring.id);
    const r3 = await createCharge(hiring.id);
    const s = await mockState();
    check(r1.status === 200 && r2.status === 200 && r3.status === 200, "5a. todas as repetições respondem 200");
    check(s.calls.create === before5 + 1, `5b. apenas UMA cobrança criada para três chamadas (${s.calls.create - before5})`);
    check(
      r1.json?.paymentId === r2.json?.paymentId && r2.json?.paymentId === r3.json?.paymentId,
      "5c. todas as respostas apontam o mesmo pagamento"
    );
    check(r2.json?.alreadyCreated === true && r3.json?.alreadyCreated === true, "5d. repetições marcadas como reutilização");
  }

  // ---------- 6) Nova tentativa legítima após tentativa encerrada ---------
  section("6. Nova tentativa legítima (cobrança anterior excluída no provedor)");
  {
    const job = await newJob("Vaga Nova Tentativa");
    const hiring = await newHiring(job, "Nova Tentativa");
    const r1 = await createCharge(hiring.id);
    check(r1.status === 200, `6a. primeira cobrança criada (HTTP ${r1.status})`);
    await mockScenario({ setPaymentStatus: { id: r1.json.paymentId, status: "DELETED" } });

    const r2 = await createCharge(hiring.id);
    check(r2.status === 200 && r2.json?.paymentId !== r1.json?.paymentId, `6b. nova tentativa criada após exclusão (HTTP ${r2.status}, novo id=${r2.json?.paymentId})`);
    const att = await attemptsOf("HIRING", hiring.id);
    check(
      att.length === 2 && att[0].attempt === 1 && att[1].attempt === 2 && att[1].state === "CONFIRMED",
      `6c. histórico de tentativas preservado (${att.map((a) => `${a.attempt}:${a.state}`).join(" ")})`
    );
    const h = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(h.providerPaymentId === r2.json?.paymentId, "6d. alvo aponta para a nova cobrança");
  }

  // ---------- 7) Falha/indisponibilidade da API de consulta ---------------
  section("7. API de consulta do provedor indisponível");
  {
    const job = await newJob("Vaga Consulta Indisponivel");
    const hiring = await newHiring(job, "Consulta Indisponivel");
    const before7 = (await mockState()).calls.create;
    await mockScenario({ listMode: "fail500" });

    const r1 = await createCharge(hiring.id);
    check(r1.status === 503, `7a. sem reconciliação possível, nada é criado (HTTP ${r1.status})`);
    const s = await mockState();
    check(s.calls.create === before7, `7b. ZERO criações enquanto a consulta falha (${s.calls.create - before7})`);
    const h = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(h.providerPaymentId === null, "7c. nenhuma cobrança gravada às cegas");
    const att = await attemptsOf("HIRING", hiring.id);
    check(att.length === 0, "7d. nenhuma tentativa registrada sem prova do provedor");

    await mockScenario({ listMode: "ok" });
    const r2 = await createCharge(hiring.id);
    check(r2.status === 200, `7e. voltando a consulta, a cobrança é criada (HTTP ${r2.status})`);
  }

  // ---------- 8) Boost em FALHOU: reconcilia antes de reiniciar -----------
  section("8. Boost FALHOU não presume que o provedor não criou nada");
  {
    const job = await newJob("Vaga Boost Falhou");
    const b1 = await boostCharge(job);
    check(b1.status === 200, `8a. cobrança do boost criada (HTTP ${b1.status})`);
    const boosts = await prisma.jobBoost.findMany({ where: { jobPostingId: job } });
    const boost = boosts[0];

    // (A) webhook marcou FALHOU, mas o provedor ainda tem a cobrança ativa.
    await prisma.jobBoost.update({
      where: { id: boost.id },
      data: { providerPaymentId: null, status: "FALHOU" },
    });
    const beforeA = (await mockState()).calls.create;
    const rA = await boostCharge(job);
    const sA = await mockState();
    check(
      rA.status === 200 && rA.json?.paymentId === b1.json.paymentId,
      `8b. cobrança ativa é readotada, não recriada (HTTP ${rA.status}, id=${rA.json?.paymentId})`
    );
    check(sA.calls.create === beforeA, `8c. nenhuma criação nova na adoção (${sA.calls.create - beforeA})`);
    const boostA = await prisma.jobBoost.findUnique({ where: { id: boost.id } });
    check(boostA.providerPaymentId === b1.json.paymentId && boostA.status === "PENDENTE", "8d. boost volta a PENDENTE com o id real");

    // (B) a cobrança anterior foi EXCLUÍDA no provedor: nova tentativa é legítima.
    await mockScenario({ setPaymentStatus: { id: b1.json.paymentId, status: "DELETED" } });
    await prisma.jobBoost.update({ where: { id: boost.id }, data: { status: "FALHOU" } });
    const rB = await boostCharge(job);
    check(
      rB.status === 200 && rB.json?.paymentId !== b1.json.paymentId,
      `8e. nova tentativa criada após exclusão real (HTTP ${rB.status}, id=${rB.json?.paymentId})`
    );
    const boostB = await prisma.jobBoost.findUnique({ where: { id: boost.id } });
    check(boostB.providerPaymentId === rB.json?.paymentId, "8f. boost aponta para a nova cobrança");
  }

  // ---------- 9) Preservação do ledger e do histórico ---------------------
  section("9. Preservação do ledger e dos registros históricos");
  {
    const after = await snapshot();
    check(
      JSON.stringify(before.ledger) === JSON.stringify(after.ledger),
      "9a. nenhum lançamento de ledger criado, alterado ou excluído"
    );
    // Os hirings de teste são criados DEPOIS do snapshot: comparamos apenas as
    // contratações pré-existentes (nenhuma pode ser alterada ou excluída).
    check(
      before.hirings.every((h) => after.hirings.includes(h)),
      "9b. nenhuma contratação pré-existente alterada ou excluída"
    );
    check(
      JSON.stringify(before.payouts) === JSON.stringify(after.payouts),
      "9c. nenhum repasse criado ou alterado"
    );
  }

  // ---------- 10) Paginação incompleta (hasMore) não prova ausência -------
  section("10. Listagem incompleta (hasMore=true) bloqueia nova cobrança");
  {
    const job = await newJob("Vaga Paginacao Incompleta");
    const hiring = await newHiring(job, "Paginacao Incompleta");
    const before10 = (await mockState()).calls.create;
    await mockScenario({ listMode: "incomplete" });

    const r1 = await createCharge(hiring.id);
    check(r1.status === 503, `10a. página truncada vira 503 (obtido ${r1.status})`);
    const s1 = await mockState();
    check(s1.calls.create === before10, `10b. ZERO criações com listagem incompleta (${s1.calls.create - before10})`);
    const h = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(h.providerPaymentId === null, "10c. nada gravado no alvo sem prova de completude");
    const att = await attemptsOf("HIRING", hiring.id);
    check(att.length === 0, "10d. nenhuma tentativa registrada sem listagem completa");

    // A consulta volta ao contrato: a ausência agora é comprovável e a
    // cobrança é criada normalmente, sem duplicata na repetição.
    await mockScenario({ listMode: "ok" });
    const r2 = await createCharge(hiring.id);
    check(r2.status === 200, `10e. listagem completa, cobrança criada (obtido ${r2.status})`);
    const r3 = await createCharge(hiring.id);
    check(
      r3.status === 200 && r3.json?.alreadyCreated === true && r3.json?.paymentId === r2.json?.paymentId,
      `10f. repetição reutiliza a mesma cobrança (obtido ${r3.status}, alreadyCreated=${r3.json?.alreadyCreated})`
    );
    const s2 = await mockState();
    check(s2.calls.create === before10 + 1, `10g. exatamente 1 criação no total (${s2.calls.create - before10})`);
  }

  // ---------- 11) Cliente por usuário (Etapa 2): criado 1x, reutilizado ----
  section("11. Cliente no provedor: criado uma única vez e reutilizado");
  {
    const s0 = await mockState();
    check(s0.customers.length === 1, `11a. exatamente 1 cliente no provedor até aqui (${s0.customers.length})`);
    const customerId = s0.customers[0]?.id ?? null;
    check(!!customerId, `11b. cliente tem id (${customerId ?? "nulo"})`);

    // Nova operação do MESMO contratante (nova contratação + nova cobrança):
    const job = await newJob("Vaga Cliente Reuso");
    const hiring = await newHiring(job, "Cliente Reuso");
    const r1 = await createCharge(hiring.id);
    check(r1.status === 200, `11c. nova cobrança criada com cliente já existente (HTTP ${r1.status})`);

    const s1 = await mockState();
    check(
      s1.calls.createCustomer === s0.calls.createCustomer,
      `11d. NENHUM cliente novo na 2ª cobrança (${s1.calls.createCustomer - s0.calls.createCustomer})`
    );
    check(s1.customers.length === 1, `11e. provedor continua com exatamente 1 cliente (${s1.customers.length})`);

    const cobranca = s1.payments.find((p) => p.externalReference === hiring.id);
    check(cobranca?.customer === customerId, `11f. pagamento usa o mesmo customerId (obtido ${cobranca?.customer ?? "nulo"})`);

    const userDb = await prisma.user.findUnique({ where: { id: contractor.id } });
    check(userDb?.asaasCustomerId === customerId, "11g. User.asaasCustomerId persistido e igual ao do provedor");
  }

  // ---------- 12) Exclusão fantasma (contrato real do DELETE) --------------
  section("12. Exclusão fantasma: DELETE some da listagem mas GET-by-id mente");
  {
    // Reproduz localmente o que o Sandbox real fez na Etapa 2: o DELETE é
    // aceito (200 deleted:true), a cobrança SOME da listagem por
    // externalReference, mas o GET-by-id continua respondendo 200/PENDING.
    // Sem a correção do checkPersistedCharge (listagem como autoridade), o
    // backend reusaria o fantasma e esta bateria reprovaria aqui.
    const job = await newJob("Vaga Exclusao Fantasma");
    const hiring = await newHiring(job, "Exclusao Fantasma");
    const r1 = await createCharge(hiring.id);
    check(r1.status === 200, `12a. primeira cobrança criada (HTTP ${r1.status})`);
    const pay1 = r1.json?.paymentId;

    // O mock exige o header `access_token` (presença) em TODAS as rotas, como
    // a lib real — as chamadas diretas daqui usam o mesmo esquema da rota.
    const mockApi = (p, init) =>
      fetch(`${MOCK}${p}`, { ...init, headers: { access_token: "bateria-local-mock" } });

    const del = await mockApi(`/v3/payments/${pay1}`, { method: "DELETE" });
    const delBody = await del.json().catch(() => null);
    check(del.status === 200 && delBody?.deleted === true, `12b. DELETE no provedor aceito (HTTP ${del.status}, deleted=${delBody?.deleted})`);

    const ghost = await mockApi(`/v3/payments/${pay1}`);
    const ghostBody = await ghost.json().catch(() => null);
    check(ghost.status === 200 && ghostBody?.status === "PENDING", `12c. GET-by-id ainda devolve a cobrança excluída (HTTP ${ghost.status}, status=${ghostBody?.status})`);

    const listGhost = await mockApi(`/v3/payments?externalReference=${encodeURIComponent(hiring.id)}`);
    const listGhostBody = await listGhost.json().catch(() => null);
    check(Array.isArray(listGhostBody?.data) && listGhostBody.data.length === 0, `12d. listagem já não retorna a cobrança excluída (${listGhostBody?.data?.length ?? "?"})`);

    const r2 = await createCharge(hiring.id);
    check(r2.status === 200 && !!r2.json?.paymentId && r2.json.paymentId !== pay1, `12e. nova tentativa criou NOVA cobrança, sem reusar o fantasma (HTTP ${r2.status}, id=${r2.json?.paymentId})`);
    const att = await attemptsOf("HIRING", hiring.id);
    check(
      att.length === 2 && att.every((a) => a.state === "CONFIRMED"),
      `12f. histórico de tentativas preservado (${att.map((a) => `${a.attempt}:${a.state}`).join(" ")})`
    );
    const h = await prisma.hiring.findUnique({ where: { id: hiring.id } });
    check(h.providerPaymentId === r2.json?.paymentId, "12g. alvo aponta para a cobrança nova");
    const listAfter = await mockApi(`/v3/payments?externalReference=${encodeURIComponent(hiring.id)}`);
    const listAfterBody = await listAfter.json().catch(() => null);
    check(listAfterBody?.data?.length === 1, `12h. EXATAMENTE 1 cobrança ativa vigente (${listAfterBody?.data?.length ?? "?"})`);
  }

  await prisma.$disconnect();

  console.log(`\n=================================================`);
  console.log(`Etapa 1+2 (mock controlado): ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("ERRO no harness:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
