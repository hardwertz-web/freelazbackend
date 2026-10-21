// Testes versionados da Etapa 6 — Fase A: CHAT (cobertura HTTP ponta a ponta).
//
// Roda CONTRA O SERVIDOR REAL, com provedor Asaas MOCK (ver .tools/mock-asaas.mjs)
// apontado por ASAAS_API_URL. Nada aqui move dinheiro real nem usa credencial de
// produção. Nenhuma feature nova é exercitada — só o comportamento que JÁ existe.
//
// Cobre (§ conforme o roteiro da Etapa 6 — Fase A):
//   §1 Chat bloqueado antes do pagamento (AGUARDANDO_PAGAMENTO);
//   §2 Chat desbloqueia após PAYMENT_CONFIRMED (RETIDO → ABERTO);
//   §3 Envio e leitura de mensagem (ambos os lados; `readAt` = null — não há
//      rota de "marcar como lida" hoje; este é o comportamento OBSERVADO);
//   §4 Autorização (terceiro 403; autor sempre da sessão, `senderId` ignorado);
//   §5 Chat após cancelamento (ENCERRADO; histórico legível; envio 409);
//   §6 Sincronização com o status da contratação (RETIDO→EM_ANDAMENTO→CONCLUIDO);
//   §7 Código de turno (X4→X5) com chat ativo e mensagem trocada no turno.
//
// Pré-requisitos (o .tools/test-chat.ps1 garante):
//   - Postgres de dev no ar (porta 5432)
//   - backend em http://localhost:3000 com ASAAS_WEBHOOK_TOKEN, INTERNAL_API_SECRET
//     e PAYOUT_SANDBOX=1 no .env e SEM ASAAS_API_KEY (webhook confia no payload)
//
// Uso: node .tools\test-chat.mjs   (exit 0 = todos os testes passaram)
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
  const cnpj = makeCnpj(`8${runId}0001`);
  const cpf = makeCpf(`${runId}31`);
  const cpfOut = makeCpf(`${runId}77`);

  const regC = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Chat Ltda",
      tradeName: `CHAT ${runId}`,
      email: `chat-empresa-${runId}@exemplo.com`,
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
      name: "Profissional Chat",
      birthDate: "1993-04-12",
      email: `chat-pro-${runId}@exemplo.com`,
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
      name: "Terceiro Chat",
      birthDate: "1990-01-01",
      email: `chat-terceiro-${runId}@exemplo.com`,
      phone: `(35) 6${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regO.status === 201, `cadastro do terceiro (HTTP ${regO.status})`);

  const loginC = await api("POST", "/api/auth/login", {
    body: { email: `chat-empresa-${runId}@exemplo.com`, password },
  });
  contractorCookie = loginC.cookie;
  check(loginC.status === 200 && !!contractorCookie, `login contratante (HTTP ${loginC.status})`);

  const loginP = await api("POST", "/api/auth/login", {
    body: { email: `chat-pro-${runId}@exemplo.com`, password },
  });
  proCookie = loginP.cookie;
  check(loginP.status === 200 && !!proCookie, `login profissional (HTTP ${loginP.status})`);

  const loginO = await api("POST", "/api/auth/login", {
    body: { email: `chat-terceiro-${runId}@exemplo.com`, password },
  });
  outsiderCookie = loginO.cookie;
  check(loginO.status === 200 && !!outsiderCookie, `login terceiro (HTTP ${loginO.status})`);

  contractor = await prisma.user.findUnique({ where: { email: `chat-empresa-${runId}@exemplo.com` } });
  pro = await prisma.user.findUnique({ where: { email: `chat-pro-${runId}@exemplo.com` } });
  outsider = await prisma.user.findUnique({ where: { email: `chat-terceiro-${runId}@exemplo.com` } });
  check(!!contractor && !!pro && !!outsider, "usuários existem no banco");
}

let hiringCounter = 0;
async function newJob(title) {
  const res = await api("POST", "/api/jobs", {
    cookie: contractorCookie,
    body: {
      title,
      description: "Vaga de teste de chat com descricao suficientemente longa.",
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
 * Cria uma contratação direto no banco (como os testes da Fase 2/4) para ancorar
 * a asserção no estado exato. `status` default = AGUARDANDO_PAGAMENTO.
 */
async function newHiring(status = "AGUARDANDO_PAGAMENTO", extra = {}) {
  hiringCounter += 1;
  const jobPostingId = await newJob(`Vaga Chat ${runId}-${hiringCounter}`);
  const application = await prisma.application.create({
    data: { jobPostingId, professionalId: pro.id, status: "SELECIONADO", agreedValueCents: 80000 },
  });
  const hiring = await prisma.hiring.create({
    data: {
      jobPostingId,
      applicationId: application.id,
      jobTitle: `Vaga Chat ${runId}-${hiringCounter}`,
      professionalId: pro.id,
      contractorId: contractor.id,
      grossValueCents: 80000,
      netValueCents: 72000,
      commissionBps: 1000,
      status,
      providerPaymentId: `pay_chat_${runId}_${hiringCounter}`,
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
    id: `evt_chat_conf_${hiring.id}_${seq}`,
  });
}

// ==========================================================================
async function main() {
  await setupAccounts();

  // ----------------------------------------------------------------------
  section("§1. Chat bloqueado antes do pagamento (AGUARDANDO_PAGAMENTO)");
  const hPre = await newHiring("AGUARDANDO_PAGAMENTO");
  // O GET cria o chat sob demanda e devolve o status (não é 403): o bloqueio
  // é expresso pelo status AGUARDANDO_PAGAMENTO + histórico vazio.
  const getPre = await api("GET", `/api/hirings/${hPre.id}/chat`, { cookie: contractorCookie });
  check(getPre.status === 200, `GET antes do pagamento responde 200 (HTTP ${getPre.status})`);
  check(
    getPre.json?.chat?.status === "AGUARDANDO_PAGAMENTO",
    `chat.status = AGUARDANDO_PAGAMENTO (${getPre.json?.chat?.status})`
  );
  check(
    Array.isArray(getPre.json?.messages) && getPre.json.messages.length === 0,
    `histórico vazio antes do pagamento (${getPre.json?.messages?.length})`
  );

  const postPre = await api("POST", `/api/hirings/${hPre.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "mensagem antes do pagamento" },
  });
  check(postPre.status === 403 || postPre.status === 409, `POST antes do pagamento é recusado (HTTP ${postPre.status})`);
  check(
    /pagamento/i.test(String(postPre.json?.error ?? "")),
    `erro cita o pagamento ("${String(postPre.json?.error ?? "").slice(0, 60)}")`
  );
  const msgPreCount = await prisma.message.count({ where: { chat: { hiringId: hPre.id } } });
  check(msgPreCount === 0, `nenhuma mensagem foi gravada antes do pagamento (${msgPreCount})`);

  // ----------------------------------------------------------------------
  section("§2. Chat desbloqueia após pagamento confirmado (RETIDO → ABERTO)");
  const hOpen = await newHiring("AGUARDANDO_PAGAMENTO");
  const before2 = await prisma.chat.findUnique({ where: { hiringId: hOpen.id } });
  check(!before2 || before2.status === "AGUARDANDO_PAGAMENTO", `antes do webhook, chat ainda não está ABERTO (${before2?.status ?? "inexistente"})`);

  const conf = await confirmHiring(hOpen, 1);
  check(conf.status === 200, `webhook PAYMENT_CONFIRMED aceito (HTTP ${conf.status})`);
  const hOpenAfter = await prisma.hiring.findUnique({ where: { id: hOpen.id } });
  check(hOpenAfter.status === "RETIDO", `contratação ficou RETIDO (${hOpenAfter.status})`);

  const getOpen = await api("GET", `/api/hirings/${hOpen.id}/chat`, { cookie: contractorCookie });
  check(getOpen.status === 200, `GET após pagamento responde 200 (HTTP ${getOpen.status})`);
  check(getOpen.json?.chat?.status === "ABERTO", `chat.status = ABERTO (${getOpen.json?.chat?.status})`);
  check(getOpen.json?.chat?.openedAt != null, `openedAt registrado (${getOpen.json?.chat?.openedAt})`);

  // ----------------------------------------------------------------------
  section("§3. Envio e leitura de mensagem (ambos os lados)");
  const sendByContractor = await api("POST", `/api/hirings/${hOpen.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Olá, tudo bem para começar?" },
  });
  check(sendByContractor.status === 201, `contratante envia mensagem → 201 (HTTP ${sendByContractor.status})`);
  check(sendByContractor.json?.message?.mine === true, `mensagem do autor vem mine=true (${sendByContractor.json?.message?.mine})`);
  check(
    sendByContractor.json?.message?.sender?.id === contractor.id,
    `autor da mensagem é a sessão (${sendByContractor.json?.message?.sender?.id})`
  );
  // Comportamento OBSERVADO: não há rota de "marcar como lida"; readAt fica null.
  check(sendByContractor.json?.message?.readAt === null, `readAt permanece null no envio (${sendByContractor.json?.message?.readAt})`);

  const sendByPro = await api("POST", `/api/hirings/${hOpen.id}/chat/messages`, {
    cookie: proCookie,
    body: { body: "Tudo ótimo, já estou a caminho." },
  });
  check(sendByPro.status === 201, `profissional envia mensagem → 201 (HTTP ${sendByPro.status})`);
  check(sendByPro.json?.message?.sender?.id === pro.id, `autor é o profissional da sessão (${sendByPro.json?.message?.sender?.id})`);

  // Lado do profissional: vê as duas mensagens, com `mine` correto.
  const readByPro = await api("GET", `/api/hirings/${hOpen.id}/chat`, { cookie: proCookie });
  check(readByPro.status === 200, `profissional lê o histórico (HTTP ${readByPro.status})`);
  check(readByPro.json?.messages?.length === 2, `profissional vê 2 mensagens (${readByPro.json?.messages?.length})`);
  const proMessages = readByPro.json?.messages ?? [];
  const mineByPro = proMessages.filter((m) => m.mine === true);
  check(mineByPro.length === 1 && mineByPro[0].sender.id === pro.id, `"mine" do profissional aponta só a dele (${mineByPro.length})`);
  check(
    proMessages.every((m) => m.readAt === null),
    `readAt continua null na leitura (não há rota de marcar como lida) (${proMessages.map((m) => m.readAt).join(",")})`
  );

  // Lado do contratante: a mesma troca com `mine` invertido.
  const readByContractor = await api("GET", `/api/hirings/${hOpen.id}/chat`, { cookie: contractorCookie });
  check(readByContractor.status === 200, `contratante lê o histórico (HTTP ${readByContractor.status})`);
  const contractorMine = (readByContractor.json?.messages ?? []).filter((m) => m.mine === true);
  check(
    contractorMine.length === 1 && contractorMine[0].sender.id === contractor.id,
    `"mine" do contratante aponta só a dele (${contractorMine.length})`
  );

  // Ordem cronológica preservada.
  const times = (readByContractor.json?.messages ?? []).map((m) => new Date(m.createdAt).getTime());
  check(times.length === 2 && times[0] <= times[1], `histórico em ordem cronológica (${times.join(" ≤ ")})`);

  // ----------------------------------------------------------------------
  section("§4. Autorização");
  const outsiderGet = await api("GET", `/api/hirings/${hOpen.id}/chat`, { cookie: outsiderCookie });
  check(outsiderGet.status === 403, `terceiro não acessa o chat → 403 (HTTP ${outsiderGet.status})`);

  const outsiderPost = await api("POST", `/api/hirings/${hOpen.id}/chat/messages`, {
    cookie: outsiderCookie,
    body: { body: "intruso" },
  });
  check(outsiderPost.status === 403, `terceiro não escreve no chat → 403 (HTTP ${outsiderPost.status})`);

  // `senderId` do corpo é IGNORADO: o autor é sempre a sessão.
  const spoof = await api("POST", `/api/hirings/${hOpen.id}/chat/messages`, {
    cookie: proCookie,
    body: { body: "tentando forjar autor", senderId: contractor.id },
  });
  check(spoof.status === 201, `POST com senderId forjado é aceito como a sessão (HTTP ${spoof.status})`);
  check(
    spoof.json?.message?.sender?.id === pro.id,
    `autor forjado NÃO é usado — gravou o da sessão (${spoof.json?.message?.sender?.id})`
  );

  // ----------------------------------------------------------------------
  section("§5. Chat após cancelamento");
  const hCancel = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hCancel, 1); // → RETIDO (chat ABERTO)
  const preCancelSend = await api("POST", `/api/hirings/${hCancel.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "mensagem antes de cancelar" },
  });
  check(preCancelSend.status === 201, `mensagem enviada com chat ABERTO (HTTP ${preCancelSend.status})`);

  const cancel = await api("POST", `/api/hirings/${hCancel.id}/cancel`, {
    cookie: contractorCookie,
    body: { reason: "desacordo no chat" },
  });
  check(cancel.status === 200, `cancelamento aceito (HTTP ${cancel.status})`);

  const hCancelAfter = await prisma.hiring.findUnique({ where: { id: hCancel.id } });
  check(hCancelAfter.status === "CANCELADO", `contratação CANCELADO (${hCancelAfter.status})`);
  const chatCancel = await prisma.chat.findUnique({ where: { hiringId: hCancel.id } });
  check(chatCancel.status === "ENCERRADO", `chat vira ENCERRADO (${chatCancel.status})`);
  check(chatCancel.closedAt != null, `closedAt registrado (${chatCancel.closedAt})`);

  const readAfterCancel = await api("GET", `/api/hirings/${hCancel.id}/chat`, { cookie: proCookie });
  check(readAfterCancel.status === 200, `histórico ainda é legível após cancelar (HTTP ${readAfterCancel.status})`);
  check(
    (readAfterCancel.json?.messages ?? []).some((m) => m.body === "mensagem antes de cancelar"),
    `mensagem histórica preservada após cancelar (${readAfterCancel.json?.messages?.length} msgs)`
  );

  const postAfterCancel = await api("POST", `/api/hirings/${hCancel.id}/chat/messages`, {
    cookie: proCookie,
    body: { body: "mensagem após cancelar" },
  });
  check(postAfterCancel.status === 409, `envio após cancelamento → 409 (HTTP ${postAfterCancel.status})`);
  check(
    /encerrada/i.test(String(postAfterCancel.json?.error ?? "")),
    `erro diz que a conversa encerrou ("${String(postAfterCancel.json?.error ?? "").slice(0, 60)}")`
  );

  // ----------------------------------------------------------------------
  section("§6. Sincronização com o status da contratação");
  const hSync = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hSync, 1); // RETIDO → chat ABERTO
  const cSync = await prisma.hiring.findUnique({ where: { id: hSync.id } });
  check(cSync.status === "RETIDO", `estado inicial RETIDO (${cSync.status})`);

  // RETIDO → EM_ANDAMENTO (código de abertura). O chat continua ABERTO.
  await prisma.hiring.update({ where: { id: hSync.id }, data: { openingCode: "111111" } });
  const openCode = await api("POST", `/api/hirings/${hSync.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "OPENING", code: "111111" },
  });
  check(openCode.status === 200, `código de abertura aceito (HTTP ${openCode.status})`);
  check(openCode.json?.hiring?.status === "EM_ANDAMENTO", `hiring EM_ANDAMENTO (${openCode.json?.hiring?.status})`);
  const chatSyncMid = await api("GET", `/api/hirings/${hSync.id}/chat`, { cookie: contractorCookie });
  check(chatSyncMid.json?.chat?.status === "ABERTO", `chat ABERTO em EM_ANDAMENTO (${chatSyncMid.json?.chat?.status})`);

  // EM_ANDAMENTO → CONCLUIDO (código de fechamento). O chat permanece ABERTO
  // (só encerra em CANCELADO/LIBERADO) — comportamento do chatService.
  await prisma.hiring.update({ where: { id: hSync.id }, data: { closingCode: "222222" } });
  const closeCode = await api("POST", `/api/hirings/${hSync.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "CLOSING", code: "222222" },
  });
  check(closeCode.status === 200, `código de fechamento aceito (HTTP ${closeCode.status})`);
  check(closeCode.json?.hiring?.status === "CONCLUIDO", `hiring CONCLUIDO (${closeCode.json?.hiring?.status})`);
  check(closeCode.json?.hiring?.closingCodeUsedAt != null, `closingCodeUsedAt marcado (${closeCode.json?.hiring?.closingCodeUsedAt})`);
  const chatSyncDone = await api("GET", `/api/hirings/${hSync.id}/chat`, { cookie: contractorCookie });
  check(chatSyncDone.json?.chat?.status === "ABERTO", `chat segue ABERTO em CONCLUIDO (${chatSyncDone.json?.chat?.status})`);

  // ----------------------------------------------------------------------
  section("§7. Fluxo X4→X5 com chat ativo (mensagem trocada durante o turno)");
  const hTurn = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hTurn, 1); // RETIDO
  await prisma.hiring.update({ where: { id: hTurn.id }, data: { openingCode: "333333" } });
  const turnOpen = await api("POST", `/api/hirings/${hTurn.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "OPENING", code: "333333" },
  });
  check(turnOpen.status === 200, `turno iniciado (OPENING) — HTTP ${turnOpen.status}`);
  check(turnOpen.json?.hiring?.status === "EM_ANDAMENTO", `EM_ANDAMENTO no turno (${turnOpen.json?.hiring?.status})`);

  const turnMsgA = await api("POST", `/api/hirings/${hTurn.id}/chat/messages`, {
    cookie: proCookie,
    body: { body: "Cheguei no local, começando agora." },
  });
  const turnMsgB = await api("POST", `/api/hirings/${hTurn.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Combinado, bom trabalho!" },
  });
  check(turnMsgA.status === 201 && turnMsgB.status === 201, `mensagens trocadas durante o turno (${turnMsgA.status},${turnMsgB.status})`);

  await prisma.hiring.update({ where: { id: hTurn.id }, data: { closingCode: "444444" } });
  const turnClose = await api("POST", `/api/hirings/${hTurn.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "CLOSING", code: "444444" },
  });
  check(turnClose.status === 200, `código de fechamento confirma a conclusão (X4→X5) — HTTP ${turnClose.status}`);
  check(turnClose.json?.hiring?.status === "CONCLUIDO", `turno concluído CONCLUIDO (${turnClose.json?.hiring?.status})`);

  const turnHistory = await api("GET", `/api/hirings/${hTurn.id}/chat`, { cookie: contractorCookie });
  check(turnHistory.status === 200, `histórico do turno legível após concluir (HTTP ${turnHistory.status})`);
  check(
    (turnHistory.json?.messages ?? []).length === 2,
    `as 2 mensagens do turno permanecem (${turnHistory.json?.messages?.length})`
  );
  check(turnHistory.json?.chat?.status === "ABERTO", `chat do turno segue ABERTO (${turnHistory.json?.chat?.status})`);

  // ----------------------------------------------------------------------
  section("§8. readAt (PATCH /api/hirings/:id/chat/messages/read)");
  const hRead = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hRead, 1); // ABERTO
  await api("POST", `/api/hirings/${hRead.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Mensagem 1 (contratante para pro)" },
  });
  await api("POST", `/api/hirings/${hRead.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Mensagem 2 (contratante para pro)" },
  });
  const readPatchPro = await api("PATCH", `/api/hirings/${hRead.id}/chat/messages/read`, {
    cookie: proCookie,
  });
  check(readPatchPro.status === 200, `profissional marca lidas → 200 (HTTP ${readPatchPro.status})`);
  check(readPatchPro.json?.marked === 2, `marcou 2 mensagens não lidas (${readPatchPro.json?.marked})`);
  const chatReadAfter = await prisma.chat.findUnique({ where: { hiringId: hRead.id }, include: { messages: { include: { sender: true } } } });
  const unreadByPro = chatReadAfter?.messages.filter((m) => m.senderId !== pro.id && m.readAt === null) ?? [];
  check(unreadByPro.length === 0, `todas as mensagens recebidas pelo pro têm readAt preenchido (${unreadByPro.length})`);
  // Novo envio após marcar: só a nova não lida conta
  await api("POST", `/api/hirings/${hRead.id}/chat/messages`, {
    cookie: contractorCookie,
    body: { body: "Mensagem 3 (nova)" },
  });
  const readPatchPro2 = await api("PATCH", `/api/hirings/${hRead.id}/chat/messages/read`, {
    cookie: proCookie,
  });
  check(readPatchPro2.status === 200, `profissional marca de novo → 200 (HTTP ${readPatchPro2.status})`);
  check(readPatchPro2.json?.marked === 1, `marcou apenas 1 mensagem nova (${readPatchPro2.json?.marked})`);

  // ----------------------------------------------------------------------
  section("§9. Soft-hide: 2h após conclusão → hiddenAt preenchido");
  const hHide = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hHide, 1);
  await prisma.hiring.update({ where: { id: hHide.id }, data: { openingCode: "555555" } });
  await api("POST", `/api/hirings/${hHide.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "OPENING", code: "555555" },
  });
  await prisma.hiring.update({ where: { id: hHide.id }, data: { closingCode: "666666" } });
  await api("POST", `/api/hirings/${hHide.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "CLOSING", code: "666666" },
  });
  // O fechamento grava completedAt = agora (setHiringStatus). Retrocedemos 3h
  // DEPOIS do POST para exercitar de verdade a janela de 2h do soft-hide.
  await prisma.hiring.update({
    where: { id: hHide.id },
    data: { completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
  const hHideAfter = await prisma.hiring.findUnique({ where: { id: hHide.id } });
  check(hHideAfter.status === "CONCLUIDO", `hiring CONCLUIDO com completedAt no passado (${hHideAfter.completedAt})`);
  // Roda o job de hide
  const hideRes = await api("POST", "/api/jobs/hide-concluded-chats/run", {
    headers: { "x-jobs-token": process.env.JOBS_RUN_TOKEN || "" },
  });
  check(hideRes.status === 200, `job hide-concluded-chats → 200 (HTTP ${hideRes.status})`);
  const chatHide = await prisma.chat.findUnique({ where: { hiringId: hHide.id } });
  check(chatHide?.hiddenAt != null, `hiddenAt preenchido após job (${chatHide?.hiddenAt})`);
  // Participante (pro): GET 404
  const getHiddenPro = await api("GET", `/api/hirings/${hHide.id}/chat`, { cookie: proCookie });
  check(getHiddenPro.status === 404, `GET chat oculto (pro) → 404 (HTTP ${getHiddenPro.status})`);
  // POST 404
  const postHiddenPro = await api("POST", `/api/hirings/${hHide.id}/chat/messages`, {
    cookie: proCookie,
    body: { body: "tentando escrever após ocultar" },
  });
  check(postHiddenPro.status === 404, `POST chat oculto → 404 (HTTP ${postHiddenPro.status})`);
  // Admin: vê normalmente (200) mesmo oculto
  const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || readEnv("INTERNAL_API_SECRET");
  const getAdminHidden = await api("GET", `/api/admin/hirings/${hHide.id}/chat`, {
    headers: INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {},
  });
  check(getAdminHidden.status === 200, `GET admin chat oculto → 200 (HTTP ${getAdminHidden.status})`);
  check(getAdminHidden.json?.hiddenAt != null, `admin vê hiddenAt (${getAdminHidden.json?.hiddenAt})`);

  // ----------------------------------------------------------------------
  section("§10. Não oculta com disputa aberta/em análise");
  const hDisp = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hDisp, 1);
  await prisma.hiring.update({ where: { id: hDisp.id }, data: { openingCode: "777777" } });
  await api("POST", `/api/hirings/${hDisp.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "OPENING", code: "777777" },
  });
  await prisma.hiring.update({ where: { id: hDisp.id }, data: { closingCode: "888888" } });
  await api("POST", `/api/hirings/${hDisp.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "CLOSING", code: "888888" },
  });
  // Backdate DEPOIS do fechamento: sem isso o chat nem entraria na janela de
  // hide e o teste de exceção passaria pelo motivo errado.
  await prisma.hiring.update({
    where: { id: hDisp.id },
    data: { completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
  // Abre disputa (via rota) — garante flag
  const disp = await api("POST", `/api/hirings/${hDisp.id}/dispute`, {
    cookie: contractorCookie,
    body: { reason: "Qualidade do serviço" },
  });
  check(disp.status === 201, `abre disputa → 201 (HTTP ${disp.status})`);
  const hideDisp = await api("POST", "/api/jobs/hide-concluded-chats/run", {
    headers: { "x-jobs-token": process.env.JOBS_RUN_TOKEN || "" },
  });
  check(hideDisp.status === 200, `job hide (com disputa) → 200 (HTTP ${hideDisp.status})`);
  const chatDisp = await prisma.chat.findUnique({ where: { hiringId: hDisp.id } });
  check(chatDisp?.hiddenAt === null, `chat NÃO ocultado com disputa (hiddenAt=null)`);
  // Participante vê 200
  const getDispPro = await api("GET", `/api/hirings/${hDisp.id}/chat`, { cookie: proCookie });
  check(getDispPro.status === 200, `chat visível para partes com disputa (HTTP ${getDispPro.status})`);

  // ----------------------------------------------------------------------
  section("§11. Não oculta com chargeback ATIVO");
  const hCb = await newHiring("AGUARDANDO_PAGAMENTO");
  await confirmHiring(hCb, 1);
  await prisma.hiring.update({ where: { id: hCb.id }, data: { openingCode: "999999" } });
  await api("POST", `/api/hirings/${hCb.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "OPENING", code: "999999" },
  });
  await prisma.hiring.update({ where: { id: hCb.id }, data: { closingCode: "000000" } });
  await api("POST", `/api/hirings/${hCb.id}/codes`, {
    cookie: contractorCookie,
    body: { kind: "CLOSING", code: "000000" },
  });
  // Backdate DEPOIS do fechamento (ver §10): garante que o único motivo de
  // não ocultar seja o ChargebackEvent ATIVO.
  await prisma.hiring.update({
    where: { id: hCb.id },
    data: { completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
  // Insere chargeback ATIVO
  await prisma.chargebackEvent.create({
    data: {
      paymentId: hCb.providerPaymentId,
      externalStatus: "IN_DISPUTE",
      state: "ATIVO",
      hiringId: hCb.id,
    },
  });
  const hideCb = await api("POST", "/api/jobs/hide-concluded-chats/run", {
    headers: { "x-jobs-token": process.env.JOBS_RUN_TOKEN || "" },
  });
  check(hideCb.status === 200, `job hide (com chargeback) → 200 (HTTP ${hideCb.status})`);
  const chatCb = await prisma.chat.findUnique({ where: { hiringId: hCb.id } });
  check(chatCb?.hiddenAt === null, `chat NÃO ocultado com chargeback ATIVO (hiddenAt=null)`);
  const getCbPro = await api("GET", `/api/hirings/${hCb.id}/chat`, { cookie: proCookie });
  check(getCbPro.status === 200, `chat visível para partes com chargeback (HTTP ${getCbPro.status})`);

  // ----------------------------------------------------------------------
  console.log(`\n==== CHAT: ${pass} OK / ${fail} FALHA ====`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\nERRO INESPERADO:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
