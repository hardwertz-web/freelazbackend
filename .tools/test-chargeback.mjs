// Testes versionados da Etapa 3 — webhook do Asaas: autenticação por
// cabeçalho, durabilidade/idempotência por `event.id`, chargeback, e bloqueio
// transacional de repasse.
//
// Roda CONTRA O SERVIDOR REAL (rota /api/webhooks/asaas e serviços de repasse)
// com provedor Asaas MOCK (ver .tools/mock-asaas.mjs) apontado por
// ASAAS_API_URL. Nada aqui move dinheiro real nem usa credencial de produção.
// PAYOUT_SANDBOX=1 faz o repasse usar o provedor de sandbox (sem dinheiro real).
//
// Pré-requisitos (o .tools/test-chargeback.ps1 garante):
//   - Postgres de dev no ar (porta 5432)
//   - backend em http://localhost:3000 com
//       ASAAS_WEBHOOK_TOKEN, INTERNAL_API_SECRET e PAYOUT_SANDBOX=1 no .env
//       e SEM ASAAS_API_KEY (o webhook confia no payload após autenticar)
//
// Uso: node .tools\test-chargeback.mjs   (exit 0 = todos os testes passaram)
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
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || readEnv("INTERNAL_API_SECRET") || "dev-secret-local";
const MOCK = process.env.MOCK_ASAAS || "http://127.0.0.1:4010";

if (!WEBHOOK_TOKEN) {
  console.error("ASAAS_WEBHOOK_TOKEN ausente — o webhook recusaria até o provedor de teste.");
  process.exit(1);
}

/**
 * Semeia o pagamento no provedor MOCK. Quando o backend tem `ASAAS_API_KEY`,
 * a rota de webhook RECONSULTA o pagamento (verificação em profundidade) — o
 * objeto precisa existir no mock com o status/valor/externalReference reais.
 */
async function seedMockPayment({ id, status = "CONFIRMED", value, externalReference }) {
  await fetch(`${MOCK}/__scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seedPayment: { id, status, value, externalReference } }),
  });
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

// ---- HTTP ----------------------------------------------------------------
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

function webhook(event, payment, { id, token, headerToken, chargeback } = {}) {
  const body = { id, event, payment };
  if (chargeback) body.chargeback = chargeback;
  if (token !== undefined) body.token = token;
  const headers =
    headerToken === null ? {} : { "asaas-access-token": headerToken ?? WEBHOOK_TOKEN };
  return api("POST", "/api/webhooks/asaas", { body, headers });
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

// ---- montagem do cenário -------------------------------------------------
const runId = String(Date.now()).slice(-7);
const password = "senhaSegura123";
let contractorCookie = null;
let contractor = null;
let pro = null;

async function setupAccounts() {
  const cnpj = makeCnpj(`7${runId}0001`);
  const cpf = makeCpf(`${runId}22`);
  const reg = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CNPJ",
      document: cnpj,
      name: "Empresa Chargeback Ltda",
      tradeName: `CB ${runId}`,
      email: `cb-empresa-${runId}@exemplo.com`,
      phone: `(35) 7${runId}`,
      password,
      roles: ["CONTRATANTE"],
      acceptedTerms: true,
    },
  });
  check(reg.status === 201, `cadastro do contratante (HTTP ${reg.status})`);
  const regPro = await api("POST", "/api/auth/register", {
    body: {
      documentType: "CPF",
      document: cpf,
      name: "Profissional Chargeback",
      birthDate: "1992-06-20",
      email: `cb-pro-${runId}@exemplo.com`,
      phone: `(35) 6${runId}`,
      password,
      roles: ["PROFISSIONAL"],
      acceptedTerms: true,
    },
  });
  check(regPro.status === 201, `cadastro do profissional (HTTP ${regPro.status})`);
  const login = await api("POST", "/api/auth/login", {
    body: { email: `cb-empresa-${runId}@exemplo.com`, password },
  });
  contractorCookie = login.cookie;
  check(login.status === 200 && !!contractorCookie, `login do contratante (HTTP ${login.status})`);
  contractor = await prisma.user.findUnique({ where: { email: `cb-empresa-${runId}@exemplo.com` } });
  pro = await prisma.user.findUnique({ where: { email: `cb-pro-${runId}@exemplo.com` } });
  check(!!contractor && !!pro, "usuários existem no banco");
  // Chave Pix do profissional (repasse sandbox).
  await prisma.user.update({ where: { id: pro.id }, data: { pixKey: "cb-teste@pix.local" } });
}

async function newJob(title) {
  const res = await api("POST", "/api/jobs", {
    cookie: contractorCookie,
    body: {
      title,
      description: "Vaga de teste de chargeback com descricao suficientemente longa.",
      category: "EVENTOS",
      valueCents: 80000,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  if (res.status !== 201) throw new Error(`criar vaga falhou: HTTP ${res.status}`);
  return res.json.jobPosting.id;
}

let hiringCounter = 0;
async function newHiring(status = "AGUARDANDO_PAGAMENTO") {
  hiringCounter += 1;
  const jobPostingId = await newJob(`Vaga CB ${runId}-${hiringCounter}`);
  const application = await prisma.application.create({
    data: { jobPostingId, professionalId: pro.id, status: "SELECIONADO", agreedValueCents: 80000 },
  });
  const hiring = await prisma.hiring.create({
    data: {
      jobPostingId,
      applicationId: application.id,
      jobTitle: `Vaga CB ${runId}-${hiringCounter}`,
      professionalId: pro.id,
      contractorId: contractor.id,
      grossValueCents: 80000,
      netValueCents: 72000,
      commissionBps: 1000,
      status,
      providerPaymentId: `pay_cb_${runId}_${hiringCounter}`,
    },
  });
  if (status !== "AGUARDANDO_PAGAMENTO") {
    // Ledger de retenção para estados com dinheiro retido.
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
  // Semeia o pagamento no provedor MOCK (o webhook reconsulta com ASAAS_API_KEY).
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

async function confirmHiring(hiring, eventSeq) {
  return webhook("PAYMENT_CONFIRMED", paymentOf(hiring), {
    id: `evt_cb_conf_${hiring.id}_${eventSeq}`,
  });
}

// ==========================================================================
async function main() {
  await setupAccounts();

  // ----------------------------------------------------------------------
  section("1. Autenticação do webhook (cabeçalho oficial)");
  const hAuth = await newHiring("AGUARDANDO_PAGAMENTO");

  const noToken = await webhook("PAYMENT_CONFIRMED", paymentOf(hAuth), {
    id: `evt_cb_auth_${hAuth.id}_1`,
    headerToken: null,
  });
  check(noToken.status === 401, `cabeçalho ausente e sem corpo → 401 (HTTP ${noToken.status})`);

  const badToken = await webhook("PAYMENT_CONFIRMED", paymentOf(hAuth), {
    id: `evt_cb_auth_${hAuth.id}_2`,
    headerToken: "token-forjado",
  });
  check(badToken.status === 401, `cabeçalho inválido → 401 (HTTP ${badToken.status})`);

  const emptyToken = await webhook("PAYMENT_CONFIRMED", paymentOf(hAuth), {
    id: `evt_cb_auth_${hAuth.id}_3`,
    headerToken: "",
  });
  check(emptyToken.status === 401, `cabeçalho vazio → 401 (HTTP ${emptyToken.status})`);

  // Corpo com `token` NÃO contorna a autenticação quando o ambiente não é de
  // teste (o dev server roda NODE_ENV=development): só o cabeçalho oficial vale.
  const bodyOnly = await webhook("PAYMENT_CONFIRMED", paymentOf(hAuth), {
    id: `evt_cb_auth_${hAuth.id}_4`,
    headerToken: null,
    token: WEBHOOK_TOKEN,
  });
  check(
    bodyOnly.status === 401,
    `body.token NÃO contorna a autenticação fora do ambiente de teste → 401 (HTTP ${bodyOnly.status})`
  );

  const goodToken = await webhook("PAYMENT_CONFIRMED", paymentOf(hAuth), {
    id: `evt_cb_auth_${hAuth.id}_5`,
  });
  check(goodToken.status === 200, `cabeçalho correto → 200 (HTTP ${goodToken.status})`);
  const hAuthAfter = await prisma.hiring.findUnique({ where: { id: hAuth.id } });
  check(hAuthAfter.status === "RETIDO", `contratação autenticada ficou RETIDO (${hAuthAfter.status})`);

  // ----------------------------------------------------------------------
  section("2. Durabilidade e idempotência por event.id");
  const hIdem = await newHiring("AGUARDANDO_PAGAMENTO");
  const evtId = `evt_cb_idem_${hIdem.id}`;

  const first = await webhook("PAYMENT_CONFIRMED", paymentOf(hIdem), { id: evtId });
  check(first.status === 200, `primeira entrega aceita (HTTP ${first.status})`);
  const rowsFirst = await prisma.asaasEvent.findMany({ where: { asaasEventId: evtId } });
  check(rowsFirst.length === 1, `evento persistido exatamente uma vez (${rowsFirst.length})`);

  const replay = await webhook("PAYMENT_CONFIRMED", paymentOf(hIdem), { id: evtId });
  check(replay.status === 200 && replay.json?.duplicate === true, `reenvio idêntico = no-op (duplicate=${replay.json?.duplicate})`);
  const rowsReplay = await prisma.asaasEvent.findMany({ where: { asaasEventId: evtId } });
  check(rowsReplay.length === 1, `reenvio não cria segunda linha de evento (${rowsReplay.length})`);
  const retIdem = await prisma.ledgerEntry.count({ where: { hiringId: hIdem.id, type: "RETENCAO" } });
  check(retIdem === 1, `reenvio não duplica RETENCAO (${retIdem})`);

  // Duas entregas SIMULTÂNEAS do mesmo evento → apenas uma linha, um efeito.
  const hConc = await newHiring("AGUARDANDO_PAGAMENTO");
  const evtConc = `evt_cb_conc_${hConc.id}`;
  const [ca, cb] = await Promise.all([
    webhook("PAYMENT_CONFIRMED", paymentOf(hConc), { id: evtConc }),
    webhook("PAYMENT_CONFIRMED", paymentOf(hConc), { id: evtConc }),
  ]);
  check([ca.status, cb.status].every((s) => s === 200), `entregas simultâneas do mesmo id respondem 200 (${ca.status},${cb.status})`);
  const rowsConc = await prisma.asaasEvent.findMany({ where: { asaasEventId: evtConc } });
  check(rowsConc.length === 1, `concorrência: uma única linha de evento (${rowsConc.length})`);
  const retConc = await prisma.ledgerEntry.count({ where: { hiringId: hConc.id, type: "RETENCAO" } });
  check(retConc === 1, `concorrência: uma única RETENCAO (${retConc})`);

  // Dois eventos DISTINTOS para o mesmo pagamento (id novo) → sem duplicar efeito.
  const hDistinct = await newHiring("AGUARDANDO_PAGAMENTO");
  await webhook("PAYMENT_CONFIRMED", paymentOf(hDistinct), { id: `evt_cb_d1_${hDistinct.id}` });
  await webhook("PAYMENT_RECEIVED", paymentOf(hDistinct), { id: `evt_cb_d2_${hDistinct.id}` });
  const retDistinct = await prisma.ledgerEntry.count({ where: { hiringId: hDistinct.id, type: "RETENCAO" } });
  check(retDistinct === 1, `dois eventos distintos no mesmo pagamento: ainda 1 RETENCAO (${retDistinct})`);

  // Evento desconhecido: persistido, sem efeito, auditável. O pagamento é
  // semeado como PENDING (não aprovado) — assim o efeito seria nulo de
  // qualquer forma e provamos que o evento em si não inventa efeito.
  const hUnknown = await newHiring("AGUARDANDO_PAGAMENTO");
  await seedMockPayment({
    id: hUnknown.providerPaymentId,
    status: "PENDING",
    value: 800,
    externalReference: hUnknown.id,
  });
  const evtUnknown = `evt_cb_unknown_${hUnknown.id}`;
  const whUnknown = await webhook("PAYMENT_SOMETHING_NEW", paymentOf(hUnknown), { id: evtUnknown });
  check(whUnknown.status === 200, `evento desconhecido aceito e persistido (HTTP ${whUnknown.status})`);
  const rowUnknown = await prisma.asaasEvent.findUnique({ where: { asaasEventId: evtUnknown } });
  check(!!rowUnknown && rowUnknown.processingStatus === "NAO_TRATADO", `evento de nome desconhecido preservado como NAO_TRATADO (status=${rowUnknown?.processingStatus})`);
  const hUnknownAfter = await prisma.hiring.findUnique({ where: { id: hUnknown.id } });
  check(hUnknownAfter.status === "AGUARDANDO_PAGAMENTO", `evento desconhecido não muda estado (${hUnknownAfter.status})`);

  // ----------------------------------------------------------------------
  section("3. Chargeback — contestação recebida (contratação RETIDO)");
  const hCb = await newHiring("RETIDO");
  const beforeLedger = await prisma.ledgerEntry.count({ where: { hiringId: hCb.id } });

  const cbReq = await webhook(
    "PAYMENT_CHARGEBACK_REQUESTED",
    paymentOf(hCb),
    {
      id: `evt_cb_req_${hCb.id}`,
      chargeback: { id: `cbk_${hCb.id}`, status: "REQUESTED", reason: "FRAUD", value: 800 },
    }
  );
  check(cbReq.status === 200, `PAYMENT_CHARGEBACK_REQUESTED aceito (HTTP ${cbReq.status})`);

  const cbRows = await prisma.chargebackEvent.findMany({ where: { hiringId: hCb.id } });
  check(cbRows.length === 1, `1 registro externo de chargeback (${cbRows.length})`);
  check(cbRows[0]?.externalStatus === "REQUESTED", `status externo original preservado (${cbRows[0]?.externalStatus})`);
  check(cbRows[0]?.externalReason === "FRAUD", `motivo externo original preservado (${cbRows[0]?.externalReason})`);
  check(cbRows[0]?.disputedValueCents === 80000, `valor contestado em centavos (${cbRows[0]?.disputedValueCents})`);
  check(cbRows[0]?.state === "ATIVO", `chargeback ATIVO (${cbRows[0]?.state})`);

  const afterLedger = await prisma.ledgerEntry.count({ where: { hiringId: hCb.id } });
  check(afterLedger === beforeLedger, `NENHUM REEMBOLSO/lançamento automático criado (${beforeLedger} → ${afterLedger})`);
  const hCbAfter = await prisma.hiring.findUnique({ where: { id: hCb.id } });
  check(hCbAfter.disputeOpen === true, `contratação marcada disputeOpen (${hCbAfter.disputeOpen})`);
  const openDisputes = await prisma.dispute.findMany({ where: { hiringId: hCb.id, status: "EM_ANALISE" } });
  check(openDisputes.length === 1, `disputa interna aberta (${openDisputes.length})`);
  check(!!cbRows[0]?.disputeId, `chargeback vinculado à disputa interna`);

  // Reenvio do mesmo evento de chargeback: no-op (não duplica disputa/registro).
  const cbReqReplay = await webhook(
    "PAYMENT_CHARGEBACK_REQUESTED",
    paymentOf(hCb),
    {
      id: `evt_cb_req_${hCb.id}`,
      chargeback: { id: `cbk_${hCb.id}`, status: "REQUESTED", reason: "FRAUD", value: 800 },
    }
  );
  check(cbReqReplay.status === 200 && cbReqReplay.json?.duplicate === true, `reenvio do chargeback é no-op`);
  const cbRows2 = await prisma.chargebackEvent.findMany({ where: { hiringId: hCb.id } });
  check(cbRows2.length === 1, `reenvio não duplica registro de chargeback (${cbRows2.length})`);
  const openDisputes2 = await prisma.dispute.count({ where: { hiringId: hCb.id, status: "EM_ANALISE" } });
  check(openDisputes2 === 1, `reenvio não duplica disputa interna (${openDisputes2})`);

  // ----------------------------------------------------------------------
  section("4. Chargeback — DISPUTE e AWAITING_REVERSAL");
  const cbDispute = await webhook(
    "PAYMENT_CHARGEBACK_DISPUTE",
    paymentOf(hCb),
    { id: `evt_cb_disp_${hCb.id}`, chargeback: { id: `cbk_${hCb.id}`, status: "IN_DISPUTE", value: 800 } }
  );
  check(cbDispute.status === 200, `PAYMENT_CHARGEBACK_DISPUTE aceito (HTTP ${cbDispute.status})`);
  const cbDisputeRow = await prisma.chargebackEvent.findFirst({
    where: { hiringId: hCb.id, providerChargebackId: `cbk_${hCb.id}`, externalStatus: "IN_DISPUTE" },
  });
  check(!!cbDisputeRow, "registro IN_DISPUTE preservado (histórico, não sobrescreve o anterior)");
  const cbRowsAfterDispute = await prisma.chargebackEvent.count({ where: { hiringId: hCb.id } });
  check(cbRowsAfterDispute === 2, `histórico preservado: 2 registros (${cbRowsAfterDispute})`);

  const cbAwait = await webhook(
    "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
    paymentOf(hCb),
    { id: `evt_cb_awt_${hCb.id}`, chargeback: { id: `cbk_${hCb.id}`, status: "AWAITING_CHARGEBACK_REVERSAL", value: 800 } }
  );
  check(cbAwait.status === 200, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL aceito (HTTP ${cbAwait.status})`);
  const activeCb = await prisma.chargebackEvent.count({ where: { hiringId: hCb.id, state: "ATIVO" } });
  check(activeCb >= 1, `ainda há chargeback ATIVO (bloqueio permanece) (${activeCb})`);
  const ledgerCb = await prisma.ledgerEntry.count({ where: { hiringId: hCb.id } });
  check(ledgerCb === beforeLedger, `nenhum lançamento criado pelos eventos de chargeback (${ledgerCb})`);

  // Valor desconhecido/parcial: preservado, sem inferir desfecho.
  const cbPartial = await webhook(
    "PAYMENT_CHARGEBACK_REQUESTED",
    paymentOf(hCb),
    { id: `evt_cb_partial_${hCb.id}`, chargeback: { id: "cbk_partial", status: "STATUS_NOVO_DO_PROVEDOR", reason: "MOTIVO_NOVO", value: 150 } }
  );
  check(cbPartial.status === 200, `status/motivo externos desconhecidos: evento aceito e preservado (HTTP ${cbPartial.status})`);
  const cbPartialRow = await prisma.chargebackEvent.findFirst({ where: { providerChargebackId: "cbk_partial" } });
  check(cbPartialRow?.externalStatus === "STATUS_NOVO_DO_PROVEDOR", `valor externo desconhecido preservado (${cbPartialRow?.externalStatus})`);
  check(cbPartialRow?.disputedValueCents === 15000, `valor parcial em centavos (${cbPartialRow?.disputedValueCents})`);

  // ----------------------------------------------------------------------
  section("5. Chargeback — pagamento/contratação não encontrados");
  await seedMockPayment({
    id: `pay_cb_orphan_${runId}`,
    status: "CONFIRMED",
    value: 800,
    externalReference: "hiring-inexistente",
  });
  const orphan = await webhook(
    "PAYMENT_CHARGEBACK_REQUESTED",
    { id: `pay_cb_orphan_${runId}`, status: "CONFIRMED", value: 800, externalReference: "hiring-inexistente" },
    { id: `evt_cb_orphan_${runId}`, chargeback: { id: "cbk_orphan", status: "REQUESTED" } }
  );
  check(orphan.status === 200, `chargeback de contratação inexistente é registrado, sem efeito (HTTP ${orphan.status})`);
  const orphanRow = await prisma.chargebackEvent.findFirst({ where: { providerChargebackId: "cbk_orphan" } });
  check(!!orphanRow && orphanRow.hiringId === null, `registro do chargeback órfão preservado (hiringId=${orphanRow?.hiringId})`);

  // ----------------------------------------------------------------------
  section("6. Bloqueio transacional de repasse");
  // 6a. Repasse sem contestação (controle): deve funcionar.
  const hOk = await newHiring("CONCLUIDO");
  await prisma.hiring.update({
    where: { id: hOk.id },
    data: { closingCodeUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
  const payOk = await api("POST", `/api/payouts/release`, {
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: { hiringId: hOk.id },
  });
  check([200, 201].includes(payOk.status), `repasse sem contestação é permitido (HTTP ${payOk.status})`);

  // 6b. Repasse com chargeback ATIVO: deve ser bloqueado (rota interna).
  const hBlocked = await newHiring("CONCLUIDO");
  await prisma.hiring.update({
    where: { id: hBlocked.id },
    data: { closingCodeUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
  await webhook("PAYMENT_CHARGEBACK_REQUESTED", paymentOf(hBlocked), {
    id: `evt_cb_block_${hBlocked.id}`,
    chargeback: { id: `cbk_block_${hBlocked.id}`, status: "REQUESTED", value: 800 },
  });
  const payBlocked = await api("POST", `/api/payouts/release`, {
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: { hiringId: hBlocked.id },
  });
  check(payBlocked.status >= 400, `repasse com chargeback ativo é BLOQUEADO (HTTP ${payBlocked.status})`);
  const payoutRow = await prisma.payout.findUnique({ where: { hiringId: hBlocked.id } });
  check(!payoutRow || payoutRow.status !== "CONCLUIDO", `nenhum Payout CONCLUIDO criado no bloqueio (${payoutRow?.status ?? "sem payout"})`);
  const leadgerBlocked = await prisma.ledgerEntry.count({ where: { hiringId: hBlocked.id, type: "LIBERACAO" } });
  check(leadgerBlocked === 0, `nenhum LIBERACAO criado no bloqueio (${leadgerBlocked})`);

  // 6c. Repasse manual (admin) com chargeback ativo: mesma proteção.
  const payManual = await api("POST", `/api/admin/payouts/${hBlocked.id}/release-manual`, {
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: { adminId: contractor.id },
  });
  check(payManual.status >= 400, `repasse MANUAL com chargeback ativo é bloqueado (HTTP ${payManual.status})`);
  // ----------------------------------------------------------------------
  section("7. Chargeback após liberação (não reverte automaticamente)");
  const hReleased = await newHiring("CONCLUIDO");
  await prisma.hiring.update({
    where: { id: hReleased.id },
    data: { closingCodeUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
  const relOk = await api("POST", `/api/payouts/release`, {
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: { hiringId: hReleased.id },
  });
  check([200, 201].includes(relOk.status), `liberação de controle concluída (HTTP ${relOk.status})`);
  const hRelAfter = await prisma.hiring.findUnique({ where: { id: hReleased.id } });
  check(hRelAfter.status === "LIBERADO", `contratação LIBERADO antes do chargeback (${hRelAfter.status})`);
  const ledgerBeforeRelease = await prisma.ledgerEntry.count({ where: { hiringId: hReleased.id } });

  const cbAfterRelease = await webhook("PAYMENT_CHARGEBACK_REQUESTED", paymentOf(hReleased), {
    id: `evt_cb_afterrel_${hReleased.id}`,
    chargeback: { id: `cbk_afterrel_${hReleased.id}`, status: "REQUESTED", value: 800 },
  });
  check(cbAfterRelease.status === 200, `chargeback após LIBERADO é registrado (HTTP ${cbAfterRelease.status})`);
  const hRelFinal = await prisma.hiring.findUnique({ where: { id: hReleased.id } });
  check(hRelFinal.status === "LIBERADO", `estado LIBERADO NÃO é revertido (${hRelFinal.status})`);
  const ledgerAfterRelease = await prisma.ledgerEntry.count({ where: { hiringId: hReleased.id } });
  check(ledgerAfterRelease === ledgerBeforeRelease, `nenhum lançamento criado no chargeback pós-liberação (${ledgerBeforeRelease} → ${ledgerAfterRelease})`);
  check(hRelFinal.disputeOpen === true, `sinalização/flag de conciliação ligada (disputeOpen=${hRelFinal.disputeOpen})`);
  const libStill = await prisma.ledgerEntry.count({ where: { hiringId: hReleased.id, type: "LIBERACAO" } });
  check(libStill >= 1, `LIBERACAO original preservada (${libStill})`);

  // ----------------------------------------------------------------------
  section("8. Disputa interna — concorrência");
  const hDup = await newHiring("RETIDO");
  const d1 = await api("POST", `/api/hirings/${hDup.id}/dispute`, {
    cookie: contractorCookie,
    body: { reason: "Contestação interna de teste (1)" },
  });
  const d2 = await api("POST", `/api/hirings/${hDup.id}/dispute`, {
    cookie: contractorCookie,
    body: { reason: "Contestação interna de teste (2)" },
  });
  const createdCount = [d1.status, d2.status].filter((s) => s === 201 || s === 200).length;
  const openCount = await prisma.dispute.count({ where: { hiringId: hDup.id, status: "EM_ANALISE" } });
  check(openCount === 1, `duas aberturas resultam em UMA disputa aberta (${openCount}; aceitas=${createdCount})`);

  // ----------------------------------------------------------------------
  section("9. Concorrência: webhook de chargeback × releasePayout");
  // Duas tentativas independentes para aumentar a chance de intercalação real.
  let consistentAll = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const hRace = await newHiring("CONCLUIDO");
    await prisma.hiring.update({
      where: { id: hRace.id },
      data: { closingCodeUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    });
    const [, ] = await Promise.all([
      api("POST", `/api/payouts/release`, {
        headers: { "x-internal-secret": INTERNAL_SECRET },
        body: { hiringId: hRace.id },
      }),
      webhook("PAYMENT_CHARGEBACK_REQUESTED", paymentOf(hRace), {
        id: `evt_cb_race_${hRace.id}`,
        chargeback: { id: `cbk_race_${hRace.id}`, status: "REQUESTED", value: 800 },
      }),
    ]);
    const hRaceAfter = await prisma.hiring.findUnique({ where: { id: hRace.id } });
    const libRace = await prisma.ledgerEntry.count({ where: { hiringId: hRace.id, type: "LIBERACAO" } });
    const payoutRace = await prisma.payout.findUnique({ where: { hiringId: hRace.id } });
    // Invariante: LIBERADO implica exatamente 1 LIBERACAO e Payout CONCLUIDO;
    // EM_DISPUTA/outro implica ZERO LIBERACAO. Nunca os dois ao mesmo tempo.
    const consistent =
      (hRaceAfter.status === "LIBERADO" && libRace === 1 && payoutRace?.status === "CONCLUIDO") ||
      (hRaceAfter.status !== "LIBERADO" && libRace === 0);
    if (!consistent) {
      console.log(
        `        inconsistência: status=${hRaceAfter.status} liberacao=${libRace} payout=${payoutRace?.status}`
      );
    }
    consistentAll = consistentAll && consistent;
  }
  check(consistentAll, "webhook × releasePayout: resultado sempre consistente (sem LIBERACAO órfã/duplicada)");

  // ----------------------------------------------------------------------
  console.log(`\n=================================================`);
  console.log(`Etapa 3 (chargeback/webhook): ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nErro fatal na bateria:", err);
  await prisma.$disconnect();
  process.exit(1);
});
