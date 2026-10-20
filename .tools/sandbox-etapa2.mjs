// Etapa 2 (pós-auditoria) — validação da integração ASAAS no SANDBOX.
//
// DIFERENÇA FUNDAMENTAL DO TESTE-IDEMPOTENCIA.MJS: aqui o provedor é o
// Asaas REAL (sandbox.asaas.com) com credencial Sandbox — não há mock.
// Por isso as salvaguardas são duras:
//   - ABORTA (exit 2) se ASAAS_API_URL não apontar para sandbox.asaas.com;
//     NUNCA roda contra produção (api.asaas.com) nem sem URL definida;
//   - ABORTA (exit 2) se ASAAS_API_KEY estiver vazia;
//   - ABORTA (exit 2) se a chave não for de SANDBOX (prefixo documentado
//     $aact_hmlg_): chave de produção ($aact_prod_) é recusada SEM ser
//     transmitida a nenhum endpoint (docs.asaas.com > Autenticação);
//   - NUNCA imprime a chave (só identificadores de teste).
//
// Pré-requisitos (registrar em progress.md ao executar):
//   1. .env do backend com ASAAS_API_URL=https://sandbox.asaas.com/api/v3,
//      ASAAS_API_KEY=<chave SANDBOX> e ASAAS_WEBHOOK_TOKEN preenchidos;
//   2. Postgres no ar e `npm run dev` reiniciado DEPOIS de mexer no .env;
//   3. executar:  node .tools\sandbox-etapa2.mjs     (exit 0 = tudo aprovado)
//
// O que este harness valida (tarefas da Etapa 2 em task_plan.md):
//   criação de cobrança pela rota real, QR Code, repetição/reuso,
//   listagem + comprobacao de completude (hasMore) no provedor real,
//   webhook emulado a partir do pagamento REAL, reenvio idempotente,
//   exclusão real + nova tentativa legítima, concorrência 2x2, boost,
//   e limpeza das cobranças de teste no Sandbox.
//
// PASSOS MANUAIS PENDENTES (NÃO inventados aqui — exigem decisão/console):
//   - confirmação de pagamento (PAYMENT_CONFIRMED) no console do Sandbox: sem
//     ela o webhook é ACEITO E IGNORADO (o status real segue PENDING — a rota
//     reconsulta a API quando há credencial) e a transição RETIDO/ledger fica
//     documentada como pendência, nunca como aprovação;
//   - reembolso/estorno (após confirmação) e transferência Pix (Etapa 2
//     registra somente se executada; ver task_plan.md).
//
// MODOS DE EXECUÇÃO:
//   node .tools\sandbox-etapa2.mjs                  fluxo completo (LIMPA as cobranças)
//   node .tools\sandbox-etapa2.mjs --keep-charges   fluxo completo SEM a limpeza:
//        deixa as cobranças PENDING vivas para confirmação MANUAL no console do
//        Sandbox e imprime os ids (necessário para provar CONFIRMED -> RETIDO).
//   node .tools\sandbox-etapa2.mjs --verify <hiringId>
//        NÃO cria nada: reconsulta o pagamento real da contratação, exige status
//        aprovado, envia o webhook com o corpo REAL e verifica RETIDO + chat
//        ABERTO + exatamente 1 RETENCAO no ledger + idempotência de reentrega
//        (reenvio do mesmo evento e evento tardio não duplicam).
//   node .tools\sandbox-etapa2.mjs --verify-boost <boostId>
//        NÃO cria nada: reconsulta a cobrança real do IMPULSIONAMENTO, exige
//        status aprovado e associação ao boost correto (externalReference
//        `boost:{boostId}` e valor), envia o webhook com o corpo REAL e verifica
//        JobBoost PAGO + providerPaymentId + jobPosting.urgentBoost=true + ZERO
//        lançamento no ledger (boost não tem `hiringId`) + nenhum chat/contratação
//        criado ou alterado + idempotência de reentrega/evento tardio.
//        Recusa a execução (sem enviar webhook) se os dados do provedor não
//        corresponderem ao boost informado.
//
// EXIT: 0 = tudo aprovado; 1 = alguma verificação reprovada; 2 = salvaguarda
// (ambiente/credencial errados).
//
// NÃO plugar este arquivo em run-all-tests.ps1: ele depende de credencial
// externa e de ambiente Sandbox — a bateria local continua 100% mock.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const backendDir = path.join(root, "freelaz-backend");

// ---------- fonte de verdade: .env do backend ----------------------------
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) {
      // O @next/env (next dev) expande "$VAR" nos valores do .env e apaga a
      // chave inteira, por isso o .env usa "\$..." (escape que o próprio
      // @next/env desfaz). Aqui fazemos o mesmo desescape antes de validar.
      out[m[1]] = m[2].trim().replace(/\\\$/g, "$");
    }
  }
  return out;
}
const envFile = readEnvFile(path.join(backendDir, ".env"));
const PROVIDER_URL = process.env.ASAAS_API_URL || envFile.ASAAS_API_URL || "";
const API_KEY = process.env.ASAAS_API_KEY || envFile.ASAAS_API_KEY || "";
const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || envFile.ASAAS_WEBHOOK_TOKEN || "";
process.env.DATABASE_URL = process.env.DATABASE_URL || envFile.DATABASE_URL;

// ---------- SALVAGUARDAS --------------------------------------------------
function abort(msg) {
  console.error(`\nABORTADO (exit 2): ${msg}`);
  process.exit(2);
}
if (!PROVIDER_URL) abort("ASAAS_API_URL vazia (`.env` do backend). Defina a URL do Sandbox e reinicie o dev server.");
if (!PROVIDER_URL.includes("sandbox.asaas.com")) {
  abort(`ASAAS_API_URL não aponta para o Sandbox (valor ocultado: ${PROVIDER_URL.replace(/\/\/[^@]*@/, "//***@")}). Esta validação NUNCA roda contra produção.`);
}
if (!API_KEY) abort("ASAAS_API_KEY vazia. Informe a chave SANDBOX no `.env` do backend e reinicie o dev server.");
// Prefixo = ambiente (docs.asaas.com > Autenticação): $aact_hmlg_ = Sandbox,
// $aact_prod_ = Produção. Chave de produção NUNCA sai daqui — nem contra o
// Sandbox (o próprio Asaas recusaria com 401 invalid_environment, mas nem
// isso: o credential não é transmitido a endpoint nenhum).
if (API_KEY.startsWith("$aact_prod_")) {
  abort("ASAAS_API_KEY é de PRODUÇÃO (prefixo $aact_prod_). Esta validação é EXCLUSIVA do Sandbox: gere uma chave em sandbox.asaas.com (prefixo $aact_hmlg_) — e REVOGUE a chave de produção, pois ela foi exposta fora de um cofre de segredos.");
}
if (!API_KEY.startsWith("$aact_hmlg_")) {
  abort("ASAAS_API_KEY não tem o formato de chave de Sandbox (esperado prefixo $aact_hmlg_; valor não exibido). Ver docs.asaas.com > Autenticação.");
}
if (!WEBHOOK_TOKEN) abort("ASAAS_WEBHOOK_TOKEN vazio no `.env` do backend.");

const require = createRequire(path.join(backendDir, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

// Modos de execução (ver cabeçalho). O modo padrão limpa tudo; `--keep-charges`
// preserva as cobranças para a confirmação manual; `--verify <hiringId>`
// comprova a transição pós-confirmação sem criar cobrança alguma.
const ARGS = process.argv.slice(2);
const KEEP_CHARGES = ARGS.includes("--keep-charges");
// Leitura defensiva dos modos --verify/--verify-boost: o flag SEM valor jamais
// pode cair no fluxo padrão (que CRIA cobranças) — aborta com o uso correto.
function argValue(flag) {
  const i = ARGS.indexOf(flag);
  return { present: i >= 0, value: i >= 0 ? ARGS[i + 1] || null : null };
}
const verifyHiringArg = argValue("--verify");
const verifyBoostArg = argValue("--verify-boost");
if (verifyHiringArg.present && !verifyHiringArg.value) {
  abort("modo --verify exige o <hiringId>: node .tools\\sandbox-etapa2.mjs --verify <hiringId>");
}
if (verifyBoostArg.present && !verifyBoostArg.value) {
  abort("modo --verify-boost exige o <boostId>: node .tools\\sandbox-etapa2.mjs --verify-boost <boostId>");
}
const VERIFY_HIRING_ID = verifyHiringArg.value;
const VERIFY_BOOST_ID = verifyBoostArg.value;

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

// ---------- provedor real (direto, sem passar pelo backend) ---------------
async function provider(method, p, body) {
  const res = await fetch(`${PROVIDER_URL}${p}`, {
    method,
    // Mesmo esquema de autenticação da lib real (asaasFetch): header
    // `access_token` — como a conta Sandbox aceita.
    headers: { access_token: API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo JSON */
  }
  return { status: res.status, json };
}

// ---------- backend -------------------------------------------------------
async function api(method, pathname, { body, cookie, headers: extraHeaders } = {}) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders ?? {}) };
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

// ---------- CPF/CNPJ válidos por execução (mesmo padrão da Etapa 1) -------
function mod11Rest(nums, weights) {
  let sum = 0;
  for (let i = 0; i < nums.length; i++) sum += nums[i] * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}
function makeCpf(base9) {
  const b = base9.split("").map(Number);
  const d1 = mod11Rest(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11Rest([...b, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${base9}${d1}${d2}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}
function makeCnpj(base12) {
  const b = base12.split("").map(Number);
  const d1 = mod11Rest(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11Rest([...b, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${base12}${d1}${d2}`;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

// ---------- montagem do cenário ------------------------------------------
const runId = String(Date.now()).slice(-7);
const contractorEmail = `etapa2-empresa-${runId}@exemplo.com`;
const proEmail = `etapa2-pro-${runId}@exemplo.com`;
const password = "senhaSegura123";
let contractorCookie = null;
let contractor = null;
let pro = null;

const refsUsadas = new Set(); // externalReference de tudo que criamos (limpeza)

async function setupAccounts() {
  const cnpj = makeCnpj(`9${runId}0001`);
  const cpf = makeCpf(`${runId}22`);
  const reg = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Etapa 2 Sandbox Ltda",
      tradeName: `Etapa2 ${runId}`,
      email: contractorEmail,
      phone: `(35) 9${runId}`,
      password,
      roles: ["CONTRATANTE"],
      acceptedTerms: true,
    },
  });
  check(reg.status === 201, `cadastro do contratante (HTTP ${reg.status}${reg.status === 201 ? "" : `: ${JSON.stringify(reg.json)}`})`);

  const regPro = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CPF",
      document: cpf,
      name: "Profissional Etapa 2",
      birthDate: "1992-07-21",
      email: proEmail,
      phone: `(35) 8${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regPro.status === 201, `cadastro do profissional (HTTP ${regPro.status}${regPro.status === 201 ? "" : `: ${JSON.stringify(regPro.json)}`})`);

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
      description: "Vaga de teste da Etapa 2 (Sandbox) com descricao suficientemente longa.",
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

// externalReference REAL (chargeService.externalReferenceFor): `hiring.id`
// para contratações e `boost:{boost.id}` para destaque — NÃO confundir com a
// idempotencyKey, que é `freelaz:*:create:{id}:{tentativa}`.
const refFor = (entity, entityId) => (entity === "HIRING" ? entityId : `boost:${entityId}`);
async function listActiveByRef(ref) {
  refsUsadas.add(ref);
  const r = await provider("GET", `/payments?externalReference=${encodeURIComponent(ref)}&limit=100`);
  if (r.status !== 200 || !Array.isArray(r.json?.data)) return { error: `HTTP ${r.status}`, data: [] };
  // Mesma semântica de isChargeActive do backend: só DELETED/REFUNDED saem.
  return {
    data: r.json.data.filter((p) => p.status !== "DELETED" && p.status !== "REFUNDED"),
    hasMore: r.json.hasMore,
  };
}

// ==========================================================================
async function main() {
  // ---- preflight: autenticidade da credencial no provedor real -----------
  section("0. Salvaguardas e autenticidade (provedor real)");
  const ping = await provider("GET", "/payments?limit=1");
  check(ping.status === 200, `0a. credencial Sandbox autenticada no provedor real (HTTP ${ping.status})`);
  if (ping.status === 401) {
    console.error("  -> ASAAS_API_KEY rejeitada (401). Confira se é a chave do SANDBOX e não a de produção.");
    await prisma.$disconnect();
    process.exit(2);
  }
  check(typeof ping.json?.hasMore === "boolean", `0b. envelope real de listagem traz hasMore (tipo ${typeof ping.json?.hasMore})`);
  check(ping.json?.limit === 1 || Number.isInteger(ping.json?.limit), `0c. limit respeitado pelo provedor (echo ${ping.json?.limit})`);

  await setupAccounts();

  // ---- 1) criação real ---------------------------------------------------
  section("1. Criação de cobrança real (rota /api/payments/create)");
  const job1 = await newJob("Vaga Sandbox Cobranca");
  const hiring1 = await newHiring(job1, "Sandbox Cobranca");
  const r1 = await createCharge(hiring1.id);
  check(r1.status === 200, `1a. cobrança criada no Sandbox (HTTP ${r1.status}${r1.status === 200 ? `: paymentId=${r1.json?.paymentId}` : `: ${JSON.stringify(r1.json)}`})`);
  if (r1.status !== 200) {
    const att = await attemptsOf("HIRING", hiring1.id);
    const lastError = att[att.length - 1]?.lastError ?? "";
    if (/customer/i.test(lastError)) {
      console.log("  DIAG   provedor recusou por falta do campo `customer` (pendência conhecida em task_plan.md) — repetir a Etapa 2 após a decisão/autorização do `customer`");
    } else if (lastError) {
      console.log(`  DIAG   último erro da tentativa: ${lastError.slice(0, 200)}`);
    }
  }
  const h1 = await prisma.hiring.findUnique({ where: { id: hiring1.id } });
  check(!!h1?.providerPaymentId, "1b. providerPaymentId persistido no banco");

  // Cliente por usuário (decisão da Etapa 2): criado uma vez, persistido e
  // usado como `customer` da cobrança no provedor real.
  const contractorDb = await prisma.user.findUnique({ where: { id: contractor.id } });
  check(
    !!contractorDb?.asaasCustomerId,
    `1c. User.asaasCustomerId persistido no banco (${contractorDb?.asaasCustomerId ?? "nulo"})`
  );
  if (contractorDb?.asaasCustomerId) {
    const cus = await provider("GET", `/customers/${contractorDb.asaasCustomerId}`);
    check(
      cus.status === 200 && cus.json?.id === contractorDb.asaasCustomerId,
      `1d. cliente consultável no provedor real (HTTP ${cus.status})`
    );
    const pay1 = h1?.providerPaymentId ? await provider("GET", `/payments/${h1.providerPaymentId}`) : null;
    check(
      pay1?.json?.customer === contractorDb.asaasCustomerId,
      `1e. cobrança usa o cliente do usuário (customer=${pay1?.json?.customer ?? "—"})`
    );
  }

  // ---- 2) QR Code real ---------------------------------------------------
  section("2. QR Code vindo do provedor real");
  check(!!r1.json?.pix?.payload, `2a. pix copia-e-cola presente na resposta (payload ${r1.json?.pix?.payload ? "ok" : "ausente"})`);
  check(!!r1.json?.pix?.qrCodeBase64, "2b. imagem base64 do QR presente na resposta");
  if (h1?.providerPaymentId) {
    const qr = await provider("GET", `/payments/${h1.providerPaymentId}/pixQrCode`);
    check(
      qr.status === 200 && (!!qr.json?.encodedQRCode || !!qr.json?.encodedImage),
      `2c. GET /payments/{id}/pixQrCode direto no provedor (HTTP ${qr.status}${qr.status === 200 ? "" : `: ${JSON.stringify(qr.json)?.slice(0, 200)}`})`
    );
  }

  // ---- 3) repetição/reuso + completude da listagem real ------------------
  section("3. Repetição reusa a cobrança; listagem real com hasMore");
  const r2 = await createCharge(hiring1.id);
  check(r2.status === 200 && r2.json?.alreadyCreated === true, `3a. repetição reutiliza (HTTP ${r2.status}, alreadyCreated=${r2.json?.alreadyCreated})`);
  check(r2.json?.paymentId === h1?.providerPaymentId, "3b. mesmo paymentId devolvido");
  const list1 = await listActiveByRef(refFor("HIRING", hiring1.id));
  check(list1.data.length === 1, `3c. EXATAMENTE 1 cobrança ativa no provedor real para a operação (${list1.data.length})`);
  check(list1.hasMore === false, `3d. provedor real devolveu hasMore=${list1.hasMore} (completude comprovada)`);

  // ---- 4) exclusão real + nova tentativa legítima ------------------------
  section("4. Exclusão real no Sandbox + nova tentativa legítima");
  if (h1?.providerPaymentId) {
    const del = await provider("DELETE", `/payments/${h1.providerPaymentId}`);
    check([200, 404].includes(del.status), `4a. cobrança excluída no provedor (HTTP ${del.status})`);
  }
  const r3 = await createCharge(hiring1.id);
  check(r3.status === 200 && !!r3.json?.paymentId && r3.json.paymentId !== h1?.providerPaymentId, `4b. nova tentativa criou NOVA cobrança (HTTP ${r3.status}, id=${r3.json?.paymentId})`);
  const att4 = await attemptsOf("HIRING", hiring1.id);
  check(
    att4.length === 2 && att4.every((a) => a.state === "CONFIRMED"),
    `4c. histórico preservado: 2 tentativas CONFIRMED (${att4.map((a) => `${a.attempt}:${a.state}`).join(" ")})`
  );
  const h1b = await prisma.hiring.findUnique({ where: { id: hiring1.id } });
  check(h1b?.providerPaymentId === r3.json?.paymentId, "4d. alvo aponta para a cobrança nova");
  const list4 = await listActiveByRef(refFor("HIRING", hiring1.id));
  check(list4.data.length === 1, `4e. 1 cobrança ativa vigente no provedor (${list4.data.length})`);

  // ---- 5) webhook emulado a partir do pagamento REAL + reenvio ----------
  section("5. Webhook com corpo do provedor real + reenvio idempotente");
  const pay = await provider("GET", `/payments/${h1b?.providerPaymentId}`);
  check(pay.status === 200 && !!pay.json?.id, `5a. pagamento consultado no provedor real (HTTP ${pay.status}, status=${pay.json?.status})`);
  // O corpo é o do PRÓPRIO provedor (nada inventado). Detalhe fundamental:
  // com ASAAS_API_KEY configurada a rota IGNORA o corpo e re-consulta a API —
  // a verdade é o status real do provedor. Sem confirmação no console, o
  // status é PENDING e o comportamento correto é ACEITAR E IGNORAR o evento
  // (sem mudar estado); a transição RETIDO/ledger só ocorre com pagamento
  // aprovado — isso é validado aqui APENAS se o pagamento estiver aprovado.
  const webhookBody = {
    id: `evt_sb1_${hiring1.id}`,
    event: "PAYMENT_CONFIRMED",
    payment: pay.json,
  };
  const wh1 = await api("POST", "/api/webhooks/asaas", {
    body: webhookBody,
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh1.status === 200, `5b. webhook aceito com corpo real (HTTP ${wh1.status}${wh1.status === 200 ? "" : `: ${JSON.stringify(wh1.json)}`})`);
  const h1c = await prisma.hiring.findUnique({ where: { id: hiring1.id } });
  const ledgerRet = await prisma.ledgerEntry.count({ where: { hiringId: hiring1.id, type: "RETENCAO" } });
  // Espelha APPROVED_STATUSES da rota de webhook (["CONFIRMED", "RECEIVED"]).
  const aprovado = ["CONFIRMED", "RECEIVED"].includes(pay.json?.status);
  if (aprovado) {
    check(h1c?.status === "RETIDO", `5c. contratação RETIDO após webhook com pagamento aprovado (status=${h1c?.status})`);
    check(ledgerRet === 1, `5d. exatamente 1 RETENCAO no ledger (${ledgerRet})`);
  } else {
    check(h1c?.status === "AGUARDANDO_PAGAMENTO", `5c. pagamento NÃO confirmado NÃO muda estado (status=${h1c?.status})`);
    check(ledgerRet === 0, `5d. nenhuma RETENCAO antes da confirmação real (${ledgerRet})`);
    console.log(`  PENDENTE  transição RETIDO/ledger exige CONFIRMAR o pagamento ${pay.json?.id} no console do Sandbox (ação manual — anotar e registrar em progress.md/task_plan.md)`);
  }
  const wh2 = await api("POST", "/api/webhooks/asaas", {
    body: webhookBody,
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh2.status === 200, `5e. reenvio aceito (HTTP ${wh2.status})`);
  const ledgerRet2 = await prisma.ledgerEntry.count({ where: { hiringId: hiring1.id, type: "RETENCAO" } });
  check(ledgerRet2 === ledgerRet, `5f. reenvio NÃO alterou a contagem de retenções (${ledgerRet2})`);

  // ---- 6) concorrência 2x2 ----------------------------------------------
  section("6. Duas requisições simultâneas (contratação nova)");
  const job6 = await newJob("Vaga Sandbox Concorrencia");
  const hiring6 = await newHiring(job6, "Sandbox Concorrencia");
  const [c1, c2] = await Promise.all([createCharge(hiring6.id), createCharge(hiring6.id)]);
  const statuses = [c1.status, c2.status].sort().join(",");
  check([c1.status, c2.status].every((s) => [200, 409].includes(s)), `6a. respostas apenas 200/409 (obtidas: ${statuses})`);
  check([c1.status, c2.status].includes(200), "6b. ao menos uma requisição recebeu a cobrança");
  const list6 = await listActiveByRef(refFor("HIRING", hiring6.id));
  check(list6.data.length === 1, `6c. EXATAMENTE 1 cobrança ativa no provedor real (${list6.data.length})`);
  const att6 = await attemptsOf("HIRING", hiring6.id);
  check(att6.filter((a) => a.state === "CONFIRMED").length === 1, `6d. uma única tentativa CONFIRMED (${att6.filter((a) => a.state === "CONFIRMED").length})`);

  // ---- 7) boost real -----------------------------------------------------
  section("7. Boost (segunda rota) no provedor real");
  const rb = await boostCharge(job6);
  check(rb.status === 200, `7a. cobrança de boost criada (HTTP ${rb.status}${rb.status === 200 ? `: paymentId=${rb.json?.paymentId}` : `: ${JSON.stringify(rb.json)}`})`);
  if (rb.status === 200 && rb.json?.boostId) {
    const list7 = await listActiveByRef(refFor("BOOST", rb.json.boostId));
    check(list7.data.length === 1, `7b. 1 cobrança ativa de boost no provedor (${list7.data.length})`);
  } else {
    check(false, "7b. boost não retornou boostId — listagem de cobrança de boost impossível");
  }

  // ---- 8) limpeza das cobranças de teste ---------------------------------
  const RECEBIDOS = ["RECEIVED", "RECEIVED_IN_CASH", "CONFIRMED"];
  if (KEEP_CHARGES) {
    // Modo manual: NÃO exclui nada. Objetivo: deixar uma cobrança PENDING viva
    // para o usuário confirmar no console do Sandbox e então rodar
    // `--verify <hiringId>` para comprovar RETIDO/chat/ledger.
    section("8. Cobranças de teste MANTIDAS vivas (--keep-charges)");
    const vivas = [];
    for (const ref of refsUsadas) {
      const l = await listActiveByRef(ref);
      for (const pgto of l.data) vivas.push({ id: pgto.id, ref, status: pgto.status });
    }
    check(vivas.length > 0, `8a. cobranças de teste MANTIDAS no Sandbox (${vivas.length}) — modo --keep-charges`);
    for (const v of vivas) console.log(`  INFO   ${v.id} | ${v.status} | ref=${v.ref}`);
    console.log("  ACAO   confirme UMA cobrança do tipo HIRING (ref = id da contratacao) no console");
    console.log("         do Sandbox (https://sandbox.asaas.com) e depois rode:");
    console.log(`         node .tools\\sandbox-etapa2.mjs --verify ${hiring1.id}`);
  } else {
    section("8. Limpeza das cobranças de teste no Sandbox");
    let removidas = 0;
    const recebidas = [];
    for (const ref of refsUsadas) {
      const l = await listActiveByRef(ref);
      for (const pgto of l.data) {
        if (RECEBIDOS.includes(pgto.status)) {
          // Já recebido: não é excluível sem estorno — decisão humana.
          recebidas.push(`${pgto.id}(${pgto.status})`);
          continue;
        }
        const d = await provider("DELETE", `/payments/${pgto.id}`);
        if ([200, 404].includes(d.status)) removidas += 1;
      }
    }
    let pendentes = 0;
    for (const ref of refsUsadas) {
      const l = await listActiveByRef(ref);
      pendentes += l.data.filter((p) => !RECEBIDOS.includes(p.status)).length;
    }
    check(pendentes === 0, `8a. nenhuma cobrança PENDENTE de teste restando no Sandbox (removidas=${removidas}, pendentes=${pendentes})`);
    if (recebidas.length) {
      console.log(`  PENDENTE  pagamento(s) já recebido(s) no Sandbox — não excluíveis sem estorno (decisão manual): ${recebidas.join(", ")}`);
    }
  }
  console.log(`  INFO   identificadores desta execução (sem segredos): runId=${runId}, contratações=${hiring1.id},${hiring6.id}, vagaBoost=${job6}`);

  // ---- pendências que este harness NÃO executa ---------------------------
  console.log("\n== Pendências manuais da Etapa 2 (fora do alcance automatizado) ==");
  console.log("  - confirmar pagamento no console do Sandbox (PAYMENT_CONFIRMADO) e reenviar o webhook a partir do estado real;");
  console.log("  - reembolso/estorno após confirmação (exige confirmação prévia no console);");
  console.log("  - transferência Pix (só se o Sandbox realizar) — exige decisão do destinatário.");

  await prisma.$disconnect();
  console.log(`\n=================================================`);
  console.log(`Etapa 2 (Sandbox real): ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==========================================================================
// MODO --verify <hiringId>: comprova a transição pós-confirmação REAL.
// Não cria nenhuma cobrança; só lê o pagamento no provedor, envia o webhook
// (com o corpo REAL do provedor) e confere o efeito no banco. Só passa se o
// pagamento já estiver APROVADO (CONFIRMED/RECEIVED) — nada é simulado.
async function verifyConfirmed(hiringId) {
  section(`V. Verificação pós-confirmação real (hiring ${hiringId})`);
  const h = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!h || !h.providerPaymentId) {
    check(false, `V0. contratação ${hiringId} existe com providerPaymentId`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  INFO   contratação ${hiringId} | status atual=${h.status} | providerPaymentId=${h.providerPaymentId} | bruto=${h.grossValueCents}`);

  const pay = await provider("GET", `/payments/${h.providerPaymentId}`);
  check(pay.status === 200 && !!pay.json?.id, `V1. pagamento real consultado (HTTP ${pay.status})`);
  const aprovado = ["CONFIRMED", "RECEIVED"].includes(pay.json?.status);
  if (!aprovado) {
    console.log(`  PENDENTE  pagamento ${h.providerPaymentId} ainda NÃO aprovado (status=${pay.json?.status}) — confirme no console do Sandbox (https://sandbox.asaas.com) e rode de novo.`);
    check(false, `V2. pagamento aprovado no provedor (status=${pay.json?.status})`);
    await prisma.$disconnect();
    process.exit(1);
  }
  check(true, `V2. pagamento aprovado no provedor (status=${pay.json?.status})`);

  // Webhook com o corpo REAL do provedor. Com credencial a rota reconsulta a
  // API — a verdade é o status real do provedor, não o corpo. O segredo vai no
  // CABEÇALHO oficial (`asaas-access-token`) e cada evento leva um `id` único.
  const body = {
    id: `evt_sbv_${hiringId}`,
    event: "PAYMENT_CONFIRMED",
    payment: pay.json,
  };
  const wh1 = await api("POST", "/api/webhooks/asaas", {
    body,
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh1.status === 200, `V3. webhook aceito com corpo real (HTTP ${wh1.status}${wh1.status === 200 ? "" : `: ${JSON.stringify(wh1.json)}`})`);

  const hAfter = await prisma.hiring.findUnique({ where: { id: hiringId } });
  check(hAfter?.status === "RETIDO", `V4. contratação RETIDO após webhook (status=${hAfter?.status})`);
  const chat = await prisma.chat.findUnique({ where: { hiringId } });
  check(!!chat && chat.status === "ABERTO", `V5. chat ABERTO (status=${chat?.status ?? "sem chat"})`);
  const ret = await prisma.ledgerEntry.count({ where: { hiringId, type: "RETENCAO" } });
  check(ret === 1, `V6. exatamente 1 RETENCAO no ledger (${ret})`);
  const entry = await prisma.ledgerEntry.findFirst({ where: { hiringId, type: "RETENCAO" } });
  check(!!entry && entry.amountCents === h.grossValueCents, `V7. valor retido = bruto da contratação (${entry?.amountCents} == ${h.grossValueCents})`);

  // Idempotência: reenvio do MESMO evento não pode duplicar a retenção.
  const wh2 = await api("POST", "/api/webhooks/asaas", {
    body,
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh2.status === 200, `V9. reenvio do webhook aceito (HTTP ${wh2.status})`);
  const ret2 = await prisma.ledgerEntry.count({ where: { hiringId, type: "RETENCAO" } });
  check(ret2 === 1, `V10. reentrega NÃO duplica retenção (${ret2})`);
  const hAfter2 = await prisma.hiring.findUnique({ where: { id: hiringId } });
  check(hAfter2?.status === "RETIDO", `V11. estado permanece RETIDO após reentrega (${hAfter2?.status})`);

  // Evento tardio/fora de ordem (PAYMENT_RECEIVED) também não pode duplicar.
  const wh3 = await api("POST", "/api/webhooks/asaas", {
    body: { id: `evt_sbv_late_${hiringId}`, event: "PAYMENT_RECEIVED", payment: pay.json },
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh3.status === 200, `V12. evento tardio aceito (HTTP ${wh3.status})`);
  const ret3 = await prisma.ledgerEntry.count({ where: { hiringId, type: "RETENCAO" } });
  check(ret3 === 1, `V13. evento tardio NÃO duplica retenção (${ret3})`);

  await prisma.$disconnect();
  console.log(`\n=================================================`);
  console.log(`Etapa 2 (verificação pós-confirmação): ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==========================================================================
// MODO --verify-boost <boostId>: comprova a transição de BOOST pós-confirmação
// REAL. Espelha o --verify (contratação), mas o caminho de boost tem outra
// regra financeira: NÃO cria LedgerEntry (boost é receita da plataforma, não
// tem `hiringId`), não abre chat e não altera contratação. Não cria cobrança;
// só lê o pagamento no provedor, envia o webhook (com o corpo REAL) e confere o
// efeito no banco. Só passa se a cobrança já estiver APROVADA e pertencer ao
// boost informado — divergência recusa a execução ANTES de enviar webhook.
async function verifyBoostPaid(boostId) {
  section(`VB. Verificação pós-confirmação real — BOOST (boost ${boostId})`);
  const boost = await prisma.jobBoost.findUnique({ where: { id: boostId } });
  if (!boost || !boost.providerPaymentId) {
    check(false, `VB0. boost ${boostId} existe com providerPaymentId`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  INFO   boost ${boostId} | status atual=${boost.status} | providerPaymentId=${boost.providerPaymentId} | jobPostingId=${boost.jobPostingId} | valor=${boost.amountCents}`);
  if (boost.status === "PAGO") {
    console.log("  INFO   boost JÁ estava PAGO antes desta execução — a transição PENDENTE->PAGO não pode ser reprovada; validando estado e idempotência.");
  }

  // 1) A verdade é a API do provedor, não o corpo do webhook.
  const pay = await provider("GET", `/payments/${boost.providerPaymentId}`);
  check(pay.status === 200 && !!pay.json?.id, `VB1. cobrança real consultada no provedor (HTTP ${pay.status})`);

  // 2) Associação/valor/status — recusa ANTES de qualquer webhook se divergir.
  const refEsperada = `boost:${boostId}`;
  const okId = pay.json?.id === boost.providerPaymentId;
  check(okId, `VB2. id do pagamento confere com o boost (${pay.json?.id})`);
  const okRef = pay.json?.externalReference === refEsperada;
  check(okRef, `VB3. externalReference confere (${pay.json?.externalReference})`);
  const valorCents = Math.round(Number(pay.json?.value ?? -1) * 100);
  const okValor = valorCents === boost.amountCents;
  check(okValor, `VB4. valor confere com o boost (${valorCents} == ${boost.amountCents})`);
  const aprovado = ["CONFIRMED", "RECEIVED"].includes(pay.json?.status);
  check(aprovado, `VB5. cobrança aprovada no provedor (status=${pay.json?.status})`);
  const naoExcluida = pay.json?.deleted !== true;
  check(naoExcluida, `VB6. cobrança não excluída (deleted=${pay.json?.deleted})`);
  if (!(pay.status === 200 && okId && okRef && okValor && aprovado && naoExcluida)) {
    console.log("  SEGURANCA  dados do provedor não correspondem ao boost solicitado (ou não está aprovado/não excluído) — NENHUM webhook foi enviado.");
    await prisma.$disconnect();
    process.exit(1);
  }

  // Snapshot local (retratos ordenados) para provar preservação.
  const snap = async () => {
    const sel = (arr) => arr.map((r) => JSON.stringify(r)).sort();
    return {
      ledger: sel(await prisma.ledgerEntry.findMany({ select: { id: true, type: true, hiringId: true, amountCents: true } })),
      chats: sel(await prisma.chat.findMany({ select: { id: true, status: true, hiringId: true } })),
      hirings: sel(await prisma.hiring.findMany({ select: { id: true, status: true, providerPaymentId: true } })),
      boosts: sel(await prisma.jobBoost.findMany({ select: { id: true, status: true, providerPaymentId: true } })),
    };
  };
  const before = await snap();
  const semAlvo = (arr) => arr.filter((s) => JSON.parse(s).id !== boostId);

  // 3) Webhook com o corpo REAL do provedor (evento de pagamento confirmado).
  //    Segredo no CABEÇALHO oficial + `id` de evento único para idempotência.
  const body = {
    id: `evt_sbvb_${boostId}`,
    event: "PAYMENT_CONFIRMED",
    payment: pay.json,
  };
  const wh1 = await api("POST", "/api/webhooks/asaas", {
    body,
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh1.status === 200, `VB7. webhook aceito com corpo real (HTTP ${wh1.status}${wh1.status === 200 ? "" : `: ${JSON.stringify(wh1.json)}`})`);

  // 4) Processamento real do boost.
  const boostAfter = await prisma.jobBoost.findUnique({ where: { id: boostId } });
  check(boostAfter?.status === "PAGO", `VB8. JobBoost PAGO após webhook (status=${boostAfter?.status})`);
  check(boostAfter?.providerPaymentId === pay.json?.id, `VB9. providerPaymentId correto (${boostAfter?.providerPaymentId})`);
  const jobAfter = await prisma.jobPosting.findUnique({ where: { id: boost.jobPostingId } });
  check(jobAfter?.urgentBoost === true, `VB10. JobPosting.urgentBoost=true (${jobAfter?.urgentBoost})`);

  // 5) Regra financeira do boost: NENHUM lançamento no ledger.
  const after = await snap();
  check(JSON.stringify(before.ledger) === JSON.stringify(after.ledger), `VB11. nenhum LedgerEntry criado/alterado/excluído (${before.ledger.length} -> ${after.ledger.length})`);

  // 6) Boost NÃO toca chat nem contratação.
  check(JSON.stringify(before.chats) === JSON.stringify(after.chats), `VB12. nenhum chat criado/alterado (${before.chats.length} -> ${after.chats.length})`);
  check(JSON.stringify(before.hirings) === JSON.stringify(after.hirings), `VB13. nenhuma contratação criada/alterada (${before.hirings.length} -> ${after.hirings.length})`);

  // 7) Idempotência: reenvio do MESMO evento e evento tardio não têm efeito.
  const wh2 = await api("POST", "/api/webhooks/asaas", {
    body,
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh2.status === 200, `VB14. reenvio do webhook aceito (HTTP ${wh2.status})`);
  const after2 = await snap();
  check(JSON.stringify(after2.boosts) === JSON.stringify(after.boosts), "VB15. reentrega não altera o JobBoost nem os demais");
  check(JSON.stringify(after2.ledger) === JSON.stringify(before.ledger), "VB16. reentrega não cria lançamento no ledger");

  const wh3 = await api("POST", "/api/webhooks/asaas", {
    body: { id: `evt_sbvb_late_${boostId}`, event: "PAYMENT_RECEIVED", payment: pay.json },
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
  check(wh3.status === 200, `VB17. evento tardio aceito (HTTP ${wh3.status})`);
  const after3 = await snap();
  const boostLate = await prisma.jobBoost.findUnique({ where: { id: boostId } });
  check(JSON.stringify(after3.boosts) === JSON.stringify(after.boosts), "VB18. evento tardio não altera o JobBoost nem os demais");
  check(boostLate?.status === "PAGO" && JSON.stringify(after3.ledger) === JSON.stringify(before.ledger), "VB19. evento tardio mantém PAGO e não cria ledger");

  // 8) Preservação do restante: nenhum outro JobBoost mudou.
  check(JSON.stringify(semAlvo(before.boosts)) === JSON.stringify(semAlvo(after3.boosts)), "VB20. demais JobBoost inalterados");

  await prisma.$disconnect();
  console.log(`\n=================================================`);
  console.log(`Etapa 2 (verificação pós-confirmação BOOST): ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  process.exit(fail === 0 ? 0 : 1);
}

const runner = VERIFY_HIRING_ID
  ? verifyConfirmed(VERIFY_HIRING_ID)
  : VERIFY_BOOST_ID
    ? verifyBoostPaid(VERIFY_BOOST_ID)
    : main();
runner.catch(async (e) => {
  console.error("ERRO FATAL:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
