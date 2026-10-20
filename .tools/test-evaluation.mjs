// Testes versionados da Etapa 6 — Fase A: AVALIAÇÃO (cobertura HTTP ponta a ponta).
//
// Roda CONTRA O SERVIDOR REAL, com provedor Asaas MOCK (ver .tools/mock-asaas.mjs)
// apontado por ASAAS_API_URL. Nada aqui move dinheiro real. Nenhuma feature nova
// é exercitada — só o comportamento que JÁ existe (X7/AV1).
//
// Cobre (§ conforme o roteiro da Etapa 6 — Fase A):
//   §1 Avaliação bloqueada antes da janela de 2h (recusa imediata após concluir);
//   §2 Avaliação libera após a janela (closingCodeUsedAt recuado via Prisma);
//   §3 Unicidade por (hiring, author) — 2ª tentativa do mesmo autor é recusada;
//   §4 Avaliação mútua — as duas existem; média (`ratingAverage`) atualizada;
//   §5 Rating fora de faixa (0, 6, negativo, fracionário) → 400;
//   §6 Comentário vazio vs. com texto (comportamento OBSERVADO);
//   §7 Autorização — terceiro não avalia; não participante → 400;
//   §8 Onde a média é exposta (GET /api/profile/professional → profile.ratingAverage).
//
// Pré-requisitos (o .tools/test-evaluation.ps1 garante):
//   - Postgres de dev no ar (porta 5432)
//   - backend em http://localhost:3000 com ASAAS_WEBHOOK_TOKEN, INTERNAL_API_SECRET
//     e PAYOUT_SANDBOX=1 no .env e SEM ASAAS_API_KEY (webhook confia no payload)
//
// Uso: node .tools\test-evaluation.mjs   (exit 0 = todos os testes passaram)
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
const MOCK = process.env.MOCK_ASAAS || "http://127.0.0.1:4010";

if (!WEBHOOK_TOKEN) {
  console.error("ASAAS_WEBHOOK_TOKEN ausente — o webhook recusaria até o provedor de teste.");
  process.exit(1);
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function seedMockPayment({ id, status = "CONFIRMED", value, externalReference }) {
  await fetch(`${MOCK}/__scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seedPayment: { id, status, value, externalReference } }),
  });
}

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

function webhook(event, payment, { id } = {}) {
  return api("POST", "/api/webhooks/asaas", {
    body: { id, event, payment },
    headers: { "asaas-access-token": WEBHOOK_TOKEN },
  });
}

// ---- documentos válidos por execução --------------------------------------
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
let contractor = null;
let pro = null;
let outsider = null;
let contractorCookie = null;
let proCookie = null;
let outsiderCookie = null;

async function setupAccounts() {
  const cnpj = makeCnpj(`9${runId}0001`);
  const cpf = makeCpf(`${runId}41`);
  const cpfOut = makeCpf(`${runId}88`);

  const regC = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Avaliacao Ltda",
      tradeName: `AVAL ${runId}`,
      email: `aval-empresa-${runId}@exemplo.com`,
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
      name: "Profissional Avaliacao",
      birthDate: "1991-09-09",
      email: `aval-pro-${runId}@exemplo.com`,
      phone: `(35) 5${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regP.status === 201, `cadastro do profissional (HTTP ${regP.status})`);

  const regO = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CPF",
      document: cpfOut,
      name: "Terceiro Avaliacao",
      birthDate: "1988-02-02",
      email: `aval-terceiro-${runId}@exemplo.com`,
      phone: `(35) 4${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regO.status === 201, `cadastro do terceiro (HTTP ${regO.status})`);

  const loginC = await api("POST", "/api/auth/login", {
    body: { email: `aval-empresa-${runId}@exemplo.com`, password },
  });
  contractorCookie = loginC.cookie;
  const loginP = await api("POST", "/api/auth/login", {
    body: { email: `aval-pro-${runId}@exemplo.com`, password },
  });
  proCookie = loginP.cookie;
  const loginO = await api("POST", "/api/auth/login", {
    body: { email: `aval-terceiro-${runId}@exemplo.com`, password },
  });
  outsiderCookie = loginO.cookie;
  check(
    loginC.status === 200 && loginP.status === 200 && loginO.status === 200,
    `logins (${loginC.status},${loginP.status},${loginO.status})`
  );

  contractor = await prisma.user.findUnique({ where: { email: `aval-empresa-${runId}@exemplo.com` } });
  pro = await prisma.user.findUnique({ where: { email: `aval-pro-${runId}@exemplo.com` } });
  outsider = await prisma.user.findUnique({ where: { email: `aval-terceiro-${runId}@exemplo.com` } });
  check(!!contractor && !!pro && !!outsider, "usuários existem no banco");
}

let hiringCounter = 0;
async function newJob(title) {
  const res = await api("POST", "/api/jobs", {
    cookie: contractorCookie,
    body: {
      title,
      description: "Vaga de teste de avaliacao com descricao suficientemente longa.",
      category: "EVENTOS",
      valueCents: 80000,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  if (res.status !== 201) throw new Error(`criar vaga falhou: HTTP ${res.status}`);
  return res.json.jobPosting.id;
}

/**
 * Cria uma contratação CONCLUIDA com `closingCodeUsedAt` controlado
 * (`hoursAgo`), como os testes da Fase 4 fazem. Sem `closingCodeUsedAt` a
 * avaliação nunca libera (§1 cobre a recusa antes da janela recuando 0 min).
 */
async function newConcludedHiring({ hoursAgo = 0, status = "CONCLUIDO" } = {}) {
  hiringCounter += 1;
  const jobPostingId = await newJob(`Vaga Aval ${runId}-${hiringCounter}`);
  const application = await prisma.application.create({
    data: { jobPostingId, professionalId: pro.id, status: "SELECIONADO", agreedValueCents: 80000 },
  });
  const usedAt = hoursAgo === null ? null : new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const hiring = await prisma.hiring.create({
    data: {
      jobPostingId,
      applicationId: application.id,
      jobTitle: `Vaga Aval ${runId}-${hiringCounter}`,
      professionalId: pro.id,
      contractorId: contractor.id,
      grossValueCents: 80000,
      netValueCents: 72000,
      commissionBps: 1000,
      status,
      completedAt: usedAt,
      closingCodeUsedAt: usedAt,
      providerPaymentId: `pay_aval_${runId}_${hiringCounter}`,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      hiringId: hiring.id,
      type: "RETENCAO",
      amountCents: 80000,
      reason: "payment_approved",
      createdBy: "system",
    },
  });
  await seedMockPayment({
    id: hiring.providerPaymentId,
    status: "CONFIRMED",
    value: 800,
    externalReference: hiring.id,
  });
  return hiring;
}

// ==========================================================================
async function main() {
  await setupAccounts();

  // ----------------------------------------------------------------------
  section("§1. Avaliação bloqueada antes da janela de 2h");
  const hBefore = await newConcludedHiring({ hoursAgo: 0 }); // usou o código AGORA
  const evalBefore = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hBefore.id, rating: 5, comment: "adiantado demais" },
  });
  check(evalBefore.status === 400, `antes da janela → 400 (HTTP ${evalBefore.status})`);
  check(
    /2h|2 horas|libera/i.test(String(evalBefore.json?.error ?? "")),
    `erro cita a janela de 2h ("${String(evalBefore.json?.error ?? "").slice(0, 70)}")`
  );
  const evalBeforeCount = await prisma.evaluation.count({ where: { hiringId: hBefore.id } });
  check(evalBeforeCount === 0, `nenhuma avaliação foi gravada antes da janela (${evalBeforeCount})`);

  // Sem closingCodeUsedAt (nunca concluído por código) também não avalia.
  const hNoCode = await newConcludedHiring({ hoursAgo: null });
  const evalNoCode = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hNoCode.id, rating: 5 },
  });
  check(evalNoCode.status === 400, `sem closingCodeUsedAt → 400 (HTTP ${evalNoCode.status})`);
  check(
    /c[oó]digo de fechamento/i.test(String(evalNoCode.json?.error ?? "")),
    `erro cita o código de fechamento ("${String(evalNoCode.json?.error ?? "").slice(0, 70)}")`
  );

  // ----------------------------------------------------------------------
  section("§2. Avaliação libera após a janela (closingCodeUsedAt recuado)");
  const hOpen = await newConcludedHiring({ hoursAgo: 3 }); // 3h atrás → janela vencida
  const evalOpen = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hOpen.id, rating: 5, comment: "Ótimo trabalho" },
  });
  check(evalOpen.status === 201, `após a janela → 201 (HTTP ${evalOpen.status})`);
  check(!!evalOpen.json?.evaluation?.id, `avaliação criada (${evalOpen.json?.evaluation?.id})`);
  check(evalOpen.json?.evaluation?.rating === 5, `rating gravado (${evalOpen.json?.evaluation?.rating})`);
  const row = await prisma.evaluation.findUnique({ where: { id: evalOpen.json?.evaluation?.id } });
  check(!!row, "avaliação persistida no banco");

  // ----------------------------------------------------------------------
  section("§3. Unicidade por (hiring, author)");
  // Mesmo autor, mesma contratação → recusa (P2002 → 400 com mensagem clara).
  const dup = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hOpen.id, rating: 3 },
  });
  check(dup.status === 400, `2ª avaliação do mesmo autor → 400 (HTTP ${dup.status})`);
  check(
    /j[aá] avaliou/i.test(String(dup.json?.error ?? "")),
    `erro diz que já avaliou ("${String(dup.json?.error ?? "").slice(0, 70)}")`
  );
  const dupCount = await prisma.evaluation.count({ where: { hiringId: hOpen.id, authorId: contractor.id } });
  check(dupCount === 1, `continua existindo 1 avaliação do autor (${dupCount})`);
  // Confirma a @@unique([hiringId, authorId]) no banco (a 2ª linha seria barrada).
  const uniqueConstraintExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_indexes WHERE tablename = 'Evaluation' AND indexdef ILIKE '%hiringId%authorId%' LIMIT 1`
  );
  check(
    Array.isArray(uniqueConstraintExists) && uniqueConstraintExists.length === 1,
    `índice único (hiringId, authorId) existe no banco`
  );

  // Profissional (o outro lado) ainda pode avaliar — unicidade é por autor.
  const evalByPro = await api("POST", "/api/evaluations", {
    cookie: proCookie,
    body: { hiringId: hOpen.id, rating: 4, comment: "Contratante tranquilo" },
  });
  check(evalByPro.status === 201, `outro lado ainda avalia → 201 (HTTP ${evalByPro.status})`);

  // ----------------------------------------------------------------------
  section("§4. Avaliação mútua e atualização da média (ratingAverage)");
  const total = await prisma.evaluation.count({ where: { hiringId: hOpen.id } });
  check(total === 2, `duas avaliações no mesmo hiring (${total})`);

  const proReceived = await prisma.evaluation.findMany({ where: { targetId: pro.id, hiringId: hOpen.id } });
  check(
    proReceived.length === 1 && proReceived[0].authorId === contractor.id,
    `profissional recebeu a avaliação do contratante (${proReceived.length})`
  );
  const contractorReceived = await prisma.evaluation.findMany({ where: { targetId: contractor.id, hiringId: hOpen.id } });
  check(
    contractorReceived.length === 1 && contractorReceived[0].authorId === pro.id,
    `contratante recebeu a avaliação do profissional (${contractorReceived.length})`
  );

  // A média é recalculada sobre TODAS as avaliações recebidas pelo alvo.
  const aggPro = await prisma.evaluation.aggregate({ where: { targetId: pro.id }, _avg: { rating: true }, _count: { rating: true } });
  const proProfile = await prisma.professionalProfile.findUnique({ where: { userId: pro.id } });
  check(proProfile != null, `professionalProfile do profissional existe`);
  check(
    proProfile?.ratingAverage != null && Math.abs(proProfile.ratingAverage - (aggPro._avg.rating ?? 0)) < 1e-9,
    `ratingAverage do profissional = média real (${proProfile?.ratingAverage} vs ${aggPro._avg.rating})`
  );
  const aggContractor = await prisma.evaluation.aggregate({ where: { targetId: contractor.id }, _avg: { rating: true } });
  const contractorProfile = await prisma.contractorProfile.findUnique({ where: { userId: contractor.id } });
  check(
    contractorProfile != null &&
      contractorProfile.ratingAverage != null &&
      Math.abs(contractorProfile.ratingAverage - (aggContractor._avg.rating ?? 0)) < 1e-9,
    `ratingAverage do contratante = média real (${contractorProfile?.ratingAverage} vs ${aggContractor._avg.rating})`
  );

  // ----------------------------------------------------------------------
  section("§5. Rating fora de faixa (0, 6, negativo, fracionário)");
  const hRate = await newConcludedHiring({ hoursAgo: 3 });
  for (const [label, rating] of [
    ["0", 0],
    ["6", 6],
    ["-1", -1],
    ["4.5", 4.5],
  ]) {
    const res = await api("POST", "/api/evaluations", {
      cookie: contractorCookie,
      body: { hiringId: hRate.id, rating },
    });
    check(res.status === 400, `rating ${label} → 400 (HTTP ${res.status})`);
    check(
      /rating/i.test(String(res.json?.error ?? "")),
      `erro do rating ${label} é claro ("${String(res.json?.error ?? "").slice(0, 60)}")`
    );
  }
  const rateCount = await prisma.evaluation.count({ where: { hiringId: hRate.id } });
  check(rateCount === 0, `nenhum rating inválido foi gravado (${rateCount})`);

  // ----------------------------------------------------------------------
  section("§6. Comentário: vazio vs. com texto (comportamento observado)");
  const hComment = await newConcludedHiring({ hoursAgo: 3 });

  // Comentário ausente/vazio → avaliação válida com comment null.
  const noComment = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hComment.id, rating: 5 },
  });
  check(noComment.status === 201, `sem comentário → 201 (HTTP ${noComment.status})`);
  check(noComment.json?.evaluation?.comment === null, `comment ausente vira null (${noComment.json?.evaluation?.comment})`);

  const hComment2 = await newConcludedHiring({ hoursAgo: 3 });
  const emptyComment = await api("POST", "/api/evaluations", {
    cookie: proCookie,
    body: { hiringId: hComment2.id, rating: 5, comment: "   " },
  });
  check(emptyComment.status === 201, `comentário só com espaços → 201 (HTTP ${emptyComment.status})`);
  check(
    emptyComment.json?.evaluation?.comment === null,
    `comentário em branco vira null (${emptyComment.json?.evaluation?.comment})`
  );

  const hComment3 = await newConcludedHiring({ hoursAgo: 3 });
  const textComment = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hComment3.id, rating: 4, comment: "  Muito atencioso  " },
  });
  check(textComment.status === 201, `comentário com texto → 201 (HTTP ${textComment.status})`);
  check(
    textComment.json?.evaluation?.comment === "Muito atencioso",
    `comentário é aparado (trim) (${JSON.stringify(textComment.json?.evaluation?.comment)})`
  );

  // Comentário acima de 500 chars → recusado (limite do serviço).
  const hComment4 = await newConcludedHiring({ hoursAgo: 3 });
  const longComment = await api("POST", "/api/evaluations", {
    cookie: contractorCookie,
    body: { hiringId: hComment4.id, rating: 4, comment: "x".repeat(501) },
  });
  check(longComment.status === 400, `comentário > 500 chars → 400 (HTTP ${longComment.status})`);

  // ----------------------------------------------------------------------
  section("§7. Autorização");
  const hAuthz = await newConcludedHiring({ hoursAgo: 3 });

  const outsider = await api("POST", "/api/evaluations", {
    cookie: outsiderCookie,
    body: { hiringId: hAuthz.id, rating: 5 },
  });
  check(outsider.status === 400, `terceiro não avalia → 400 (HTTP ${outsider.status})`);
  check(
    /participa/i.test(String(outsider.json?.error ?? "")),
    `erro diz que não participa ("${String(outsider.json?.error ?? "").slice(0, 70)}")`
  );

  const noAuth = await api("POST", "/api/evaluations", { body: { hiringId: hAuthz.id, rating: 5 } });
  check(noAuth.status === 401, `sem sessão → 401 (HTTP ${noAuth.status})`);

  const missingId = await api("POST", "/api/evaluations", { cookie: contractorCookie, body: { rating: 5 } });
  check(missingId.status === 400, `sem hiringId → 400 (HTTP ${missingId.status})`);

  // ----------------------------------------------------------------------
  section("§8. Onde a média é exposta (GET /api/profile/professional)");
  // Recalcula a média AGORA (as seções anteriores somaram novas avaliações ao
  // profissional — a média é sobre TODAS as recebidas, não só a desta vaga).
  const aggProNow = await prisma.evaluation.aggregate({
    where: { targetId: pro.id },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const profileRes = await api("GET", "/api/profile/professional", { cookie: proCookie });
  check(profileRes.status === 200, `GET do perfil do profissional (HTTP ${profileRes.status})`);
  check(
    profileRes.json?.profile?.ratingAverage != null,
    `ratingAverage exposto no perfil (${profileRes.json?.profile?.ratingAverage})`
  );
  check(
    Math.abs(profileRes.json?.profile?.ratingAverage - (aggProNow._avg.rating ?? 0)) < 1e-9,
    `valor exposto = média no banco (${profileRes.json?.profile?.ratingAverage} vs ${aggProNow._avg.rating})`
  );

  // ----------------------------------------------------------------------
  console.log(`\n==== AVALIAÇÃO: ${pass} OK / ${fail} FALHA ====`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\nERRO INESPERADO:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
