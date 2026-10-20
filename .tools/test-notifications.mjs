// Testes versionados da Etapa 7 — Fase B: NOTIFICAÇÕES (in-app + e-mail) e
// `Message.readAt` do chat.
//
// Roda CONTRA O SERVIDOR REAL, com provedor Asaas MOCK (ver .tools/mock-asaas.mjs)
// apontado por ASAAS_API_URL. Nada aqui move dinheiro real nem usa credencial de
// produção. WhatsApp NÃO tem provider: o dispatch o marca como SKIPPED.
//
// Cobre (§ conforme o roteiro da Etapa 7 — Fase B):
//   §1 CRUD de notificação (criar via serviço, GET lista, unreadCount);
//   §2 Marcar como lida (PATCH individual + read-all);
//   §3 Preferência (desligar EMAIL → entrega SKIPPED; in-app continua);
//   §4 Idempotência por dedupeKey (2 chamadas → 1 notificação, 1 delivery);
//   §5 E-mail capturado em EMAIL_CAPTURE_FILE (to/subject/body com o código);
//   §6 WhatsApp modelado = SKIPPED (channel_not_implemented);
//   §7 Chat readAt (PATCH .../chat/messages/read marca só as recebidas);
//   §8 Eventos reais de código (opening/closing) via /api/jobs/*\/run;
//   §9 Proposta (invite) e contraproposta (counter-offer) reais.
//
// Pré-requisitos (o .tools/test-notifications.ps1 garante):
//   - Postgres de dev no ar (porta 5432)
//   - backend em http://localhost:3000 com JOBS_RUN_TOKEN de teste,
//     ASAAS_WEBHOOK_TOKEN, PAYOUT_SANDBOX=1, EMAIL_TRANSPORT=json e
//     EMAIL_CAPTURE_FILE apontando para .tools/tmp/emails.jsonl
//
// Uso: node .tools\test-notifications.mjs   (exit 0 = todos os testes passaram)
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
const JOBS_TOKEN = process.env.JOBS_RUN_TOKEN || "";
const EMAIL_CAPTURE_FILE =
  process.env.EMAIL_CAPTURE_FILE || path.join(here, "tmp", "emails.jsonl");

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
if (!JOBS_TOKEN) {
  console.error("JOBS_RUN_TOKEN ausente — as rotas de job responderiam 401.");
  process.exit(1);
}

/** Semeia o pagamento no provedor MOCK (o webhook reconsulta o objeto real). */
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

function jobsRun(route) {
  return api("POST", `/api/jobs/${route}/run`, { headers: { "x-jobs-token": JOBS_TOKEN } });
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
let contractor = null;
let pro = null;
let outsider = null;
let contractorCookie = null;
let proCookie = null;
let outsiderCookie = null;

async function setupAccounts() {
  const cnpj = makeCnpj(`7${runId}0001`);
  const cpf = makeCpf(`${runId}31`);
  const cpfOut = makeCpf(`${runId}77`);

  const regC = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Notifica Ltda",
      tradeName: `NOTIF ${runId}`,
      email: `notif-empresa-${runId}@exemplo.com`,
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
      name: "Profissional Notifica",
      birthDate: "1993-04-12",
      email: `notif-pro-${runId}@exemplo.com`,
      phone: `(35) 7${runId}`,
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
      name: "Terceiro Notifica",
      birthDate: "1990-01-01",
      email: `notif-terceiro-${runId}@exemplo.com`,
      phone: `(35) 6${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regO.status === 201, `cadastro do terceiro (HTTP ${regO.status})`);

  const loginC = await api("POST", "/api/auth/login", {
    body: { email: `notif-empresa-${runId}@exemplo.com`, password },
  });
  contractorCookie = loginC.cookie;
  check(loginC.status === 200 && !!contractorCookie, `login contratante (HTTP ${loginC.status})`);

  const loginP = await api("POST", "/api/auth/login", {
    body: { email: `notif-pro-${runId}@exemplo.com`, password },
  });
  proCookie = loginP.cookie;
  check(loginP.status === 200 && !!proCookie, `login profissional (HTTP ${loginP.status})`);

  const loginO = await api("POST", "/api/auth/login", {
    body: { email: `notif-terceiro-${runId}@exemplo.com`, password },
  });
  outsiderCookie = loginO.cookie;
  check(loginO.status === 200 && !!outsiderCookie, `login terceiro (HTTP ${loginO.status})`);

  contractor = await prisma.user.findUnique({ where: { email: `notif-empresa-${runId}@exemplo.com` } });
  pro = await prisma.user.findUnique({ where: { email: `notif-pro-${runId}@exemplo.com` } });
  outsider = await prisma.user.findUnique({ where: { email: `notif-terceiro-${runId}@exemplo.com` } });
  check(!!contractor && !!pro && !!outsider, "usuários existem no banco");

  // Os testes chamam rotas que exigem papel ATIVO (invite exige o alvo
  // Profissional ATIVO). Ativa os papéis direto no banco, como as outras
  // baterias fazem (evita depender do fluxo de verificação manual).
  await prisma.userRoleAssignment.updateMany({
    where: { userId: { in: [contractor.id, pro.id, outsider.id] } },
    data: { status: "ATIVO" },
  });
  const activeRoles = await prisma.userRoleAssignment.count({
    where: { userId: { in: [contractor.id, pro.id, outsider.id] }, status: "ATIVO" },
  });
  check(activeRoles >= 3, `papéis ativados no banco (${activeRoles})`);
}

let jobCounter = 0;
/** Cria uma vaga pública e devolve o JobPosting. */
async function newJob(overrides = {}) {
  jobCounter += 1;
  const res = await api("POST", "/api/jobs", {
    cookie: contractorCookie,
    body: {
      title: `Vaga Notif ${runId}-${jobCounter}`,
      description: "Vaga de teste de notificacao com descricao suficientemente longa.",
      category: "EVENTOS",
      valueCents: 80000,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
      ...overrides,
    },
  });
  if (res.status !== 201) throw new Error(`criar vaga falhou: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.jobPosting;
}

/**
 * Cria uma contratação direto no banco (como as outras baterias). `status`
 * default = AGUARDANDO_PAGAMENTO. Permite ajustar a janela da vaga para os
 * jobs de código (opening = início em ~1h; closing = fim em ~1h).
 */
async function newHiring(status = "AGUARDANDO_PAGAMENTO", { job, extra = {} } = {}) {
  const jobPosting = job ?? (await newJob());
  const application = await prisma.application.create({
    data: { jobPostingId: jobPosting.id, professionalId: pro.id, status: "SELECIONADO", agreedValueCents: 80000 },
  });
  const hiring = await prisma.hiring.create({
    data: {
      jobPostingId: jobPosting.id,
      applicationId: application.id,
      jobTitle: jobPosting.title,
      professionalId: pro.id,
      contractorId: contractor.id,
      grossValueCents: 80000,
      netValueCents: 72000,
      commissionBps: 1000,
      status,
      providerPaymentId: `pay_notif_${runId}_${jobPosting.id}`,
      ...extra,
    },
  });
  if (status !== "AGUARDANDO_PAGAMENTO") {
    await prisma.ledgerEntry.create({
      data: {
        hiringId: hiring.id,
        type: "RETENCAO",
        amountCents: 80000,
        reason: "payment_approved",
        createdBy: "system",
      },
    });
  }
  await seedMockPayment({
    id: hiring.providerPaymentId,
    status: "CONFIRMED",
    value: 800,
    externalReference: hiring.id,
  });
  return hiring;
}

const paymentOf = (hiring) => ({
  id: hiring.providerPaymentId,
  status: "CONFIRMED",
  value: 800,
  externalReference: hiring.id,
  dateCreated: new Date().toISOString(),
});
async function confirmHiring(hiring, seq = 1) {
  return webhook("PAYMENT_CONFIRMED", paymentOf(hiring), {
    id: `evt_notif_conf_${hiring.id}_${seq}`,
  });
}

/**
 * Cria uma notificação de teste direto no banco.
 *
 * Decisão: NÃO existe rota para CRIAR notificação (por design — só o serviço
 * interno emite, a partir dos 4 eventos reais). Para exercitar o CRUD/leitura
 * de forma determinística, semeamos a linha pelo Prisma; os eventos REAIS são
 * cobertos nos §8/§9 via job/invite/counter-offer (que passam pelo serviço).
 */
async function createViaPrisma({ userId, type, title, body, payload, dedupeKey }) {
  return prisma.notification.create({
    data: { userId, type, title, body, payload: payload ?? undefined, dedupeKey: dedupeKey ?? null },
  });
}

function readCapturedEmails() {
  if (!fs.existsSync(EMAIL_CAPTURE_FILE)) return [];
  return fs
    .readFileSync(EMAIL_CAPTURE_FILE, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ==========================================================================
async function main() {
  await setupAccounts();

  // ----------------------------------------------------------------------
  section("§1. CRUD de notificação (criar, listar, unreadCount)");
  const notifA = await createViaPrisma({
    userId: pro.id,
    type: "PROPOSAL_RECEIVED",
    title: `Teste §1 a-${runId}`,
    body: "Corpo da notificação de teste §1.",
    payload: { jobTitle: "Vaga §1", applicationId: `app_${runId}` },
    dedupeKey: `test:§1:a:${runId}`,
  });
  const notifB = await createViaPrisma({
    userId: pro.id,
    type: "COUNTER_PROPOSAL_RECEIVED",
    title: `Teste §1 b-${runId}`,
    body: "Segundo item.",
    dedupeKey: `test:§1:b:${runId}`,
  });

  const list1 = await api("GET", "/api/notifications", { cookie: proCookie });
  check(list1.status === 200, `GET /api/notifications responde 200 (HTTP ${list1.status})`);
  check(Array.isArray(list1.json?.notifications), "resposta traz array `notifications`");
  const ids = (list1.json?.notifications ?? []).map((n) => n.id);
  check(ids.includes(notifA.id) && ids.includes(notifB.id), `as 2 notificações aparecem na lista (${ids.length})`);
  check(list1.json?.unreadCount === 2, `unreadCount = 2 (${list1.json?.unreadCount})`);

  // A lista é do usuário da sessão: o terceiro não vê as dele.
  const listOutsider = await api("GET", "/api/notifications", { cookie: outsiderCookie });
  check(
    (listOutsider.json?.notifications ?? []).every((n) => n.id !== notifA.id && n.id !== notifB.id),
    "terceiro não enxerga notificações de outro usuário"
  );

  // unreadOnly filtra.
  const listUnread = await api("GET", "/api/notifications?unreadOnly=1", { cookie: proCookie });
  check(
    (listUnread.json?.notifications ?? []).some((n) => n.id === notifA.id),
    "?unreadOnly=1 traz as não lidas"
  );

  // ----------------------------------------------------------------------
  section("§2. Marcar como lida (individual e read-all)");
  const markOne = await api("PATCH", `/api/notifications/${notifA.id}/read`, { cookie: proCookie });
  check(markOne.status === 200, `PATCH individual responde 200 (HTTP ${markOne.status})`);
  const afterOne = await prisma.notification.findUnique({ where: { id: notifA.id } });
  check(afterOne.readAt != null, `readAt preenchido após marcar (${afterOne.readAt})`);
  const listAfterOne = await api("GET", "/api/notifications", { cookie: proCookie });
  check(listAfterOne.json?.unreadCount === 1, `unreadCount caiu para 1 (${listAfterOne.json?.unreadCount})`);

  // Terceiro não pode marcar notificação alheia → 404.
  const markOther = await api("PATCH", `/api/notifications/${notifB.id}/read`, { cookie: outsiderCookie });
  check(markOther.status === 404, `terceiro não marca notificação alheia → 404 (HTTP ${markOther.status})`);

  const readAll = await api("POST", "/api/notifications/read-all", { cookie: proCookie });
  check(readAll.status === 200, `POST read-all responde 200 (HTTP ${readAll.status})`);
  check(readAll.json?.marked >= 1, `read-all marcou >= 1 (${readAll.json?.marked})`);
  const listAfterAll = await api("GET", "/api/notifications", { cookie: proCookie });
  check(listAfterAll.json?.unreadCount === 0, `unreadCount = 0 após read-all (${listAfterAll.json?.unreadCount})`);

  // ----------------------------------------------------------------------
  section("§3. Preferência desliga um canal (EMAIL → SKIPPED; in-app segue)");
  const prefPut = await api("PUT", "/api/notification-preferences", {
    cookie: proCookie,
    body: {
      preferences: [{ type: "OPENING_CODE_GENERATED", channel: "EMAIL", enabled: false }],
    },
  });
  check(prefPut.status === 200, `PUT preferências responde 200 (HTTP ${prefPut.status})`);

  const prefGet = await api("GET", "/api/notification-preferences", { cookie: proCookie });
  const emailPref = (prefGet.json?.preferences ?? []).find(
    (p) => p.type === "OPENING_CODE_GENERATED" && p.channel === "EMAIL"
  );
  check(emailPref?.enabled === false, `preferência EMAIL registrada como disabled (${emailPref?.enabled})`);

  // Dispara um evento real (invite) que NÃO é o desligado — e um opening via job.
  // Para testar a preferência de forma dirigida, usamos o evento real de
  // abertura de código, com EMAIL desligado: a entrega EMAIL deve ser SKIPPED,
  // e a IN_APP deve continuar SENT.
  const jobForPref = await newJob({
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  });
  await newHiring("RETIDO", { job: jobForPref });
  const runPref = await jobsRun("opening-codes");
  check(runPref.status === 200, `job opening-codes roda (HTTP ${runPref.status})`);

  const notifPref = await prisma.notification.findUnique({
    where: { dedupeKey: `opening_code:${(await prisma.hiring.findFirst({ where: { jobPostingId: jobForPref.id } })).id}` },
    include: { deliveries: true },
  });
  check(!!notifPref, "notificação de abertura criada para o cenário de preferência");
  if (notifPref) {
    const emailDelivery = notifPref.deliveries.find((d) => d.channel === "EMAIL");
    const inAppDelivery = notifPref.deliveries.find((d) => d.channel === "IN_APP");
    check(emailDelivery?.status === "SKIPPED", `entrega EMAIL = SKIPPED com preferência off (${emailDelivery?.status})`);
    check(inAppDelivery?.status === "SENT", `entrega IN_APP segue SENT (${inAppDelivery?.status})`);
  }
  // Restaura a preferência (deixa EMAIL ligado para os testes seguintes).
  await api("PUT", "/api/notification-preferences", {
    cookie: proCookie,
    body: { preferences: [{ type: "OPENING_CODE_GENERATED", channel: "EMAIL", enabled: true }] },
  });

  // ----------------------------------------------------------------------
  section("§4. Idempotência por dedupeKey (2 chamadas → 1 notificação)");
  // O dedupeKey é a chave: a MESMA operação reexecutada não duplica. Usamos o
  // job de abertura 2x: a 2ª execução não gera código (já existe) e não
  // duplica a notificação (dedupeKey).
  const jobIdem = await newJob({
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  });
  const hiringIdem = await newHiring("RETIDO", { job: jobIdem });
  await jobsRun("opening-codes");
  await jobsRun("opening-codes");
  const idemNotifs = await prisma.notification.findMany({
    where: { dedupeKey: `opening_code:${hiringIdem.id}` },
    include: { deliveries: true },
  });
  check(idemNotifs.length === 1, `existe exatamente 1 notificação de abertura (${idemNotifs.length})`);
  if (idemNotifs.length === 1) {
    const inApp = idemNotifs[0].deliveries.filter((d) => d.channel === "IN_APP");
    check(inApp.length === 1, `1 delivery IN_APP (não redisparou) (${inApp.length})`);
  }
  // Duplicidade via Prisma: o @unique barra.
  let dupErr = null;
  try {
    await prisma.notification.create({
      data: { userId: pro.id, type: "PROPOSAL_RECEIVED", title: "dup", body: "dup", dedupeKey: `opening_code:${hiringIdem.id}` },
    });
  } catch (err) {
    dupErr = err;
  }
  check(!!dupErr, "criar com dedupeKey repetido viola o @unique (P2002)");

  // ----------------------------------------------------------------------
  section("§5. E-mail capturado (EMAIL_TRANSPORT=json)");
  const jobMail = await newJob({
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  });
  const hiringMail = await newHiring("RETIDO", { job: jobMail });
  await jobsRun("opening-codes");

  const notifMail = await prisma.notification.findUnique({
    where: { dedupeKey: `opening_code:${hiringMail.id}` },
    include: { deliveries: true },
  });
  check(!!notifMail, "notificação de abertura criada (cenário de e-mail)");
  const hiringMailRow = await prisma.hiring.findUnique({ where: { id: hiringMail.id } });
  const codeMail = hiringMailRow?.openingCode ?? "";
  check(!!codeMail, `código de abertura persistido (${codeMail})`);

  const emails = readCapturedEmails();
  const captured = emails.filter((e) => e.subject && /c[oó]digo de abertura/i.test(e.subject));
  check(captured.length >= 1, `e-mail com assunto de código de abertura capturado (${captured.length})`);
  if (captured.length >= 1) {
    const last = captured[captured.length - 1];
    check(last.to === `notif-pro-${runId}@exemplo.com`, `destinatário correto (${last.to})`);
    const text = `${last.subject}\n${last.text}\n${last.html}`;
    check(text.includes(codeMail), `corpo do e-mail contém o código (${codeMail})`);
    check(text.includes(jobMail.title), `corpo do e-mail contém o nome da vaga (${jobMail.title})`);
  }
  const mailDelivery = notifMail?.deliveries.find((d) => d.channel === "EMAIL");
  check(mailDelivery?.status === "SENT", `entrega EMAIL = SENT (${mailDelivery?.status})`);

  // ----------------------------------------------------------------------
  section("§6. WhatsApp modelado = SKIPPED");
  const waDeliveries = await prisma.notificationDelivery.findMany({
    where: { notificationId: notifMail?.id ?? "", channel: "WHATSAPP" },
  });
  check(waDeliveries.length === 1, `existe 1 delivery WhatsApp (${waDeliveries.length})`);
  check(waDeliveries[0]?.status === "SKIPPED", `WhatsApp = SKIPPED (${waDeliveries[0]?.status})`);
  check(
    waDeliveries[0]?.error === "channel_not_implemented",
    `WhatsApp traz error=channel_not_implemented (${waDeliveries[0]?.error})`
  );

  // ----------------------------------------------------------------------
  section("§7. Chat readAt (PATCH .../chat/messages/read)");
  const hChat = await newHiring("AGUARDANDO_PAGAMENTO");
  const confChat = await confirmHiring(hChat, 1);
  check(confChat.status === 200, `webhook PAYMENT_CONFIRMED aceito (HTTP ${confChat.status})`);

  const msgA = await api("POST", `/api/hirings/${hChat.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Mensagem A→B" },
  });
  check(msgA.status === 201, `contratante envia mensagem (HTTP ${msgA.status})`);
  check(msgA.json?.message?.readAt === null, `readAt null no envio (${msgA.json?.message?.readAt})`);

  const readByPro = await api("PATCH", `/api/hirings/${hChat.id}/chat/messages/read`, { cookie: proCookie });
  check(readByPro.status === 200, `profissional marca como lidas (HTTP ${readByPro.status})`);
  check(readByPro.json?.marked === 1, `marked = 1 (só a recebida) (${readByPro.json?.marked})`);

  const msgARow = await prisma.message.findUnique({ where: { id: msgA.json.message.id } });
  check(msgARow.readAt != null, `readAt da mensagem A preenchido (${msgARow.readAt})`);

  // Nova mensagem: marcar de novo conta SÓ a nova.
  const msgC = await api("POST", `/api/hirings/${hChat.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Mensagem A→B (nova)" },
  });
  const readAgain = await api("PATCH", `/api/hirings/${hChat.id}/chat/messages/read`, { cookie: proCookie });
  check(readAgain.json?.marked === 1, `marcar de novo conta só a nova (${readAgain.json?.marked})`);

  // Quem enviou não marca a própria mensagem como recebida.
  const msgFromPro = await api("POST", `/api/hirings/${hChat.id}/chat/messages`, {
    cookie: proCookie,
    body: { body: "Mensagem B→A" },
  });
  const readAsPro = await api("PATCH", `/api/hirings/${hChat.id}/chat/messages/read`, { cookie: proCookie });
  check(readAsPro.json?.marked === 0, `o autor não marca a própria mensagem (${readAsPro.json?.marked})`);
  const msgFromProRow = await prisma.message.findUnique({ where: { id: msgFromPro.json.message.id } });
  check(msgFromProRow.readAt === null, `mensagem do próprio autor segue com readAt null (${msgFromProRow.readAt})`);

  // Terceiro → 403.
  const readOutsider = await api("PATCH", `/api/hirings/${hChat.id}/chat/messages/read`, { cookie: outsiderCookie });
  check(readOutsider.status === 403, `terceiro não marca no chat → 403 (HTTP ${readOutsider.status})`);

  // Sem sessão → 401.
  const readAnon = await api("PATCH", `/api/hirings/${hChat.id}/chat/messages/read`, {});
  check(readAnon.status === 401, `sem sessão → 401 (HTTP ${readAnon.status})`);

  // ----------------------------------------------------------------------
  section("§8. Evento real de código (opening e closing)");
  const jobClose = await newJob({
    startsAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const hiringClose = await newHiring("EM_ANDAMENTO", {
    job: jobClose,
    extra: { openingCode: "555555" },
  });
  const runClose = await jobsRun("closing-codes");
  check(runClose.status === 200, `job closing-codes roda (HTTP ${runClose.status})`);

  const notifClose = await prisma.notification.findUnique({
    where: { dedupeKey: `closing_code:${hiringClose.id}` },
    include: { deliveries: true },
  });
  check(!!notifClose, "notificação CLOSING_CODE_GENERATED existe");
  check(notifClose?.type === "CLOSING_CODE_GENERATED", `tipo correto (${notifClose?.type})`);
  check(notifClose?.userId === contractor.id, `destinatário é o contratante (${notifClose?.userId === contractor.id})`);
  const hiringCloseRow = await prisma.hiring.findUnique({ where: { id: hiringClose.id } });
  check(!!hiringCloseRow?.closingCode, `closingCode persistido (${hiringCloseRow?.closingCode})`);

  // Notificação de abertura do §5 já existe — reforça o tipo/rota.
  check(notifMail?.type === "OPENING_CODE_GENERATED", `tipo OPENING_CODE_GENERATED (${notifMail?.type})`);
  check(notifMail?.userId === pro.id, `destinatário da abertura é o profissional (${notifMail?.userId === pro.id})`);

  // ----------------------------------------------------------------------
  section("§9. Proposta (invite) e contraproposta (counter-offer) reais");
  const invite = await api("POST", "/api/jobs/invite", {
    cookie: contractorCookie,
    body: {
      targetProfessionalId: pro.id,
      title: `Convite Notif ${runId}`,
      description: "Convite de teste de notificacao com descricao longa o suficiente.",
      category: "EVENTOS",
      valueCents: 50000,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  check(invite.status === 201, `POST /jobs/invite responde 201 (HTTP ${invite.status})`);
  const invitedApp = invite.json?.jobPosting?.applications?.[0];
  check(!!invitedApp, "convite trouxe a candidatura automática");

  const notifProposal = await prisma.notification.findUnique({
    where: { dedupeKey: `proposal:${invitedApp?.id}` },
  });
  check(!!notifProposal, "notificação PROPOSAL_RECEIVED existe");
  check(notifProposal?.type === "PROPOSAL_RECEIVED", `tipo correto (${notifProposal?.type})`);
  check(notifProposal?.userId === pro.id, `destinatário é o profissional-alvo (${notifProposal?.userId === pro.id})`);

  // Contraproposta: o profissional propõe → notifica o CONTRATANTE.
  const counter = await api("POST", `/api/applications/${invitedApp?.id}/counter-offer`, {
    cookie: proCookie,
    body: { valueCents: 60000 },
  });
  check(counter.status === 200, `POST counter-offer responde 200 (HTTP ${counter.status})`);

  const notifCounter = await prisma.notification.findUnique({
    where: { dedupeKey: `counter:${invitedApp?.id}:PROFESSIONAL` },
  });
  check(!!notifCounter, "notificação COUNTER_PROPOSAL_RECEIVED existe");
  check(notifCounter?.type === "COUNTER_PROPOSAL_RECEIVED", `tipo correto (${notifCounter?.type})`);
  check(
    notifCounter?.userId === contractor.id,
    `contraproposta do profissional notifica o contratante (${notifCounter?.userId === contractor.id})`
  );

  // O outro sentido: o contratante contrapropõe → notifica o profissional.
  const counterBack = await api("POST", `/api/applications/${invitedApp?.id}/counter-offer`, {
    cookie: contractorCookie,
    body: { valueCents: 55000 },
  });
  check(counterBack.status === 200, `contraproposta de volta responde 200 (HTTP ${counterBack.status})`);
  const notifCounterBack = await prisma.notification.findUnique({
    where: { dedupeKey: `counter:${invitedApp?.id}:CONTRACTOR` },
  });
  check(!!notifCounterBack, "contraproposta do contratante cria notificação");
  check(
    notifCounterBack?.userId === pro.id,
    `contraproposta do contratante notifica o profissional (${notifCounterBack?.userId === pro.id})`
  );

  // ----------------------------------------------------------------------
  console.log(`\n==== NOTIFICAÇÕES: ${pass} OK / ${fail} FALHA ====`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\nERRO INESPERADO:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
