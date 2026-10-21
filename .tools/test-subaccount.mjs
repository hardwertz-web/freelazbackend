// Testes versionados da Etapa 7.3b — onboarding de subconta Asaas (MOCK).
//
// Roda CONTRA O SERVIDOR REAL, com provedor Asaas MOCK (ver .tools/mock-asaas.mjs)
// apontado por ASAAS_API_URL. NENHUMA chamada ao Sandbox/produção é feita.
//
// Como a feature flag é lida do ambiente no boot do servidor, o
// `test-subaccount.ps1` roda este arquivo em DUAS fases:
//   SUBACCOUNT_PHASE=off  → §1 (401), §2 (403), §3 (503, flag desligada)
//   SUBACCOUNT_PHASE=on   → §4 (400 missing + perfil completo/backward compat),
//                           §5 (criação no mock + persistência + segredo),
//                           §6 (idempotência)
//
// Uso: node .tools\test-subaccount.mjs   (exit 0 = todos os testes passaram)
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
const MOCK = process.env.MOCK_ASAAS || "http://127.0.0.1:4014";
const PHASE = process.env.SUBACCOUNT_PHASE || "on";
const DEV_LOG = process.env.DEV_LOG || "";

// ---- contadores/asserts ---------------------------------------------------
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

// ---- documentos válidos por execução (mesmo padrão das outras baterias) ---
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

// ---- montagem do cenário --------------------------------------------------
const runId = String(Date.now()).slice(-7);
const password = "senhaSegura123";
const prefix = `sub-${PHASE}-${runId}`;
let contractor = null;
let pro = null;
let contractorCookie = null;
let proCookie = null;

async function setupAccounts() {
  const cnpj = makeCnpj(`9${runId}0001`);
  const cpf = makeCpf(`${runId}41`);

  const regC = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Subconta Ltda",
      tradeName: `SUBCONTA ${runId}`,
      email: `${prefix}-empresa@exemplo.com`,
      phone: `(35) 8${runId}`,
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
      name: "Profissional Subconta",
      birthDate: "1992-06-15",
      email: `${prefix}-pro@exemplo.com`,
      phone: `(35) 7${runId}`,
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
  check(!!contractor && !!pro, "usuários existem no banco");

  // A rota exige papel PROFISSIONAL ATIVO (o fluxo real de verificação é
  // manual); as baterias ativam direto no banco.
  await prisma.userRoleAssignment.updateMany({
    where: { userId: { in: [contractor.id, pro.id] } },
    data: { status: "ATIVO" },
  });
  const active = await prisma.userRoleAssignment.count({
    where: { userId: { in: [contractor.id, pro.id] }, status: "ATIVO" },
  });
  check(active >= 2, `papéis ativados no banco (${active})`);
}

const ADDRESS = {
  postalCode: "38400-000",
  address: "Rua das Subcontas",
  addressNumber: "123",
  province: "Centro",
  incomeValueCents: 350000,
};

async function phaseOff() {
  section("§1. Sem session → 401");
  const noSession = await api("POST", "/api/profile/subaccount");
  check(noSession.status === 401, `POST sem cookie → HTTP ${noSession.status}`);
  check(noSession.json?.error === "Não autenticado", `mensagem de 401: ${noSession.json?.error}`);

  section("§2. Papel não-PROFISSIONAL → 403");
  const asContractor = await api("POST", "/api/profile/subaccount", { cookie: contractorCookie });
  check(asContractor.status === 403, `POST como CONTRATANTE → HTTP ${asContractor.status}`);
  check(
    String(asContractor.json?.error ?? "").includes("profissional"),
    `mensagem de 403: ${asContractor.json?.error}`
  );

  section("§3. Feature flag desligada → 503 sem chamar o provedor");
  const before = await mockState();
  const off = await api("POST", "/api/profile/subaccount", { cookie: proCookie });
  check(off.status === 503, `POST com ASAAS_SUBACCOUNT_ENABLED=false → HTTP ${off.status}`);
  check(off.json?.error === "Subcontas desabilitadas", `mensagem de 503: ${off.json?.error}`);
  const after = await mockState();
  check(
    after.calls.createSubaccount === before.calls.createSubaccount,
    `provedor não foi chamado (createSubaccount=${after.calls.createSubaccount})`
  );
  const stored = await prisma.user.findUnique({ where: { id: pro.id } });
  check(stored?.asaasSubaccountId === null, "nenhuma subconta persistida com a flag off");
}

async function phaseOn() {
  section("§4. Perfil incompleto → 400 com missing; perfil completo → PUT aceita");
  // Backward compatibility: um PUT antigo (só bio) continua funcionando.
  const legacy = await api("PUT", "/api/profile/professional", {
    cookie: proCookie,
    body: { bio: "Perfil antigo sem endereço." },
  });
  check(legacy.status === 200, `PUT só com bio (chamada antiga) → HTTP ${legacy.status}`);
  check(legacy.json?.profile?.bio === "Perfil antigo sem endereço.", "bio antiga persistida");

  const incomplete = await api("POST", "/api/profile/subaccount", { cookie: proCookie });
  check(incomplete.status === 400, `POST sem endereço → HTTP ${incomplete.status}`);
  check(incomplete.json?.ok === false, "resposta tem ok=false");
  const missing = Array.isArray(incomplete.json?.missing) ? incomplete.json.missing : [];
  for (const field of ["postalCode", "address", "addressNumber", "province", "incomeValueCents"]) {
    check(missing.includes(field), `missing inclui ${field}`);
  }
  const afterMissing = await mockState();
  check(
    afterMissing.calls.createSubaccount === 0,
    `provedor não chamado com perfil incompleto (createSubaccount=${afterMissing.calls.createSubaccount})`
  );

  const filled = await api("PUT", "/api/profile/professional", {
    cookie: proCookie,
    body: ADDRESS,
  });
  check(filled.status === 200, `PUT com os 5 campos novos → HTTP ${filled.status}`);
  const withAddress = await prisma.user.findUnique({ where: { id: pro.id } });
  check(withAddress?.postalCode === "38400000", `postalCode normalizado (${withAddress?.postalCode})`);
  check(withAddress?.address === ADDRESS.address, "address persistido");
  check(withAddress?.addressNumber === ADDRESS.addressNumber, "addressNumber persistido");
  check(withAddress?.province === ADDRESS.province, "province persistido");
  check(withAddress?.incomeValueCents === ADDRESS.incomeValueCents, "incomeValueCents persistido");

  section("§5. Criação no mock → persistência sem expor a apiKey");
  const create = await api("POST", "/api/profile/subaccount", { cookie: proCookie });
  check(create.status === 200, `POST com perfil completo → HTTP ${create.status}`);
  check(create.json?.ok === true, "resposta tem ok=true");
  check(typeof create.json?.subaccountId === "string" && create.json.subaccountId.length > 0, "subaccountId devolvido");
  check(create.json?.status === "PENDING", `status devolvido = ${create.json?.status}`);
  check(create.json?.skipped === false, `skipped = ${create.json?.skipped}`);
  check(!JSON.stringify(create.json ?? {}).includes("apiKey"), "response NÃO contém apiKey");

  const saved = await prisma.user.findUnique({ where: { id: pro.id } });
  check(saved?.asaasSubaccountId === create.json?.subaccountId, "asaasSubaccountId persistido no User");
  check(typeof saved?.asaasSubaccountApiKey === "string" && saved.asaasSubaccountApiKey.length > 0, "asaasSubaccountApiKey persistida");
  check(saved?.asaasSubaccountStatus === "PENDING", `asaasSubaccountStatus = ${saved?.asaasSubaccountStatus}`);

  const mock = await mockState();
  check(mock.subaccounts.length === 1, `mock recebeu 1 subconta (${mock.subaccounts.length})`);
  check(mock.calls.createSubaccount === 1, `POST /v3/accounts chamado 1x (${mock.calls.createSubaccount})`);

  if (DEV_LOG && fs.existsSync(DEV_LOG)) {
    const log = fs.readFileSync(DEV_LOG, "utf8");
    check(!log.includes(saved.asaasSubaccountApiKey), "apiKey NÃO aparece no log do dev server");
  } else {
    check(false, `log do dev server não encontrado (${DEV_LOG || "DEV_LOG vazio"})`);
  }

  section("§6. Idempotência → 2ª chamada skipped, mesmo id, sem novo POST ao provedor");
  const again = await api("POST", "/api/profile/subaccount", { cookie: proCookie });
  check(again.status === 200, `2ª chamada → HTTP ${again.status}`);
  check(again.json?.ok === true, "2ª chamada ok=true");
  check(again.json?.skipped === true, `2ª chamada skipped = ${again.json?.skipped}`);
  check(again.json?.subaccountId === create.json?.subaccountId, "mesmo subaccountId");
  const mock2 = await mockState();
  check(mock2.calls.createSubaccount === 1, `provedor continua com 1 criação (${mock2.calls.createSubaccount})`);
  const saved2 = await prisma.user.findUnique({ where: { id: pro.id } });
  check(saved2?.asaasSubaccountId === create.json?.subaccountId, "id persistido não mudou");
}

async function main() {
  if (PHASE !== "off" && PHASE !== "on") {
    throw new Error(`SUBACCOUNT_PHASE inválido: ${PHASE} (use off|on)`);
  }
  console.log(`\n#### test-subaccount.mjs — fase ${PHASE} ####`);
  await setupAccounts();
  if (PHASE === "off") await phaseOff();
  else await phaseOn();

  console.log(`\n==== SUBCONTA (${PHASE}): ${pass} OK / ${fail} FALHA ====`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\nERRO INESPERADO:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
