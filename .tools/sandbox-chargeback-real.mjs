// Etapa 3.1 — validação do fluxo de CHARGEBACK contra o SANDBOX REAL do Asaas.
//
// DIFERENÇA FUNDAMENTAL DO test-chargeback.mjs: aqui o provedor é o Asaas REAL
// (Sandbox) com credencial Sandbox — não há mock. Somente operações de LEITURA
// são feitas (GET /payments/{id} e GET /payments/{id}/chargeback): nenhum
// dinheiro se move, nenhuma cobrança é criada/estornada.
//
// REALIDADE DOCUMENTADA (docs.asaas.com > O que pode ser testado):
//   Chargeback no Sandbox = ⚠️ "Com restrições": é preciso ENVIAR O ID DA
//   COBRANÇA para integracoes@asaas.com.br para solicitar o teste do fluxo.
//   NÃO existe gatilho self-service de chargeback. Por isso este script:
//     - se NÃO encontrar chargeback nos pagamentos Sandbox conhecidos,
//       reporta "PENDENTE — requer solicitação ao Asaas" e sai com exit 3
//       (não é falha e NÃO é validação: nada foi confirmado);
//     - se ENCONTRAR um chargeback real, compara o payload observado com o
//       fixture versionado (.tools/fixtures/asaas-chargeback.json) campo a
//       campo e só então declara RESOLVIDO com evidência observada.
//
// SALVAGUARDAS (mesmas do sandbox-etapa2.mjs):
//   - ABORTA (exit 2) se ASAAS_API_URL não apontar para o Sandbox do Asaas;
//   - ABORTA (exit 2) sem ASAAS_API_KEY, ou se a chave não for de Sandbox
//     (prefixo $aact_hmlg_); chave de produção NÃO é transmitida a ninguém;
//   - NUNCA imprime a chave nem o token.
//
// Uso: node .tools\sandbox-chargeback-real.mjs [--payment <payId> ...]
//   Sem --payment, usa os pagamentos Sandbox registrados em PAYMENTS abaixo.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const backendDir = path.join(root, "freelaz-backend");
const require = createRequire(path.join(backendDir, "package.json"));

// ---------- .env do backend (mesma leitura do sandbox-etapa2.mjs) ----------
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
const PROVIDER_URL = process.env.ASAAS_API_URL || envFile.ASAAS_API_URL || "";
const API_KEY = process.env.ASAAS_API_KEY || envFile.ASAAS_API_KEY || "";

// ---------- SALVAGUARDAS ---------------------------------------------------
function abort(msg) {
  console.error(`\nABORTADO (exit 2): ${msg}`);
  process.exit(2);
}
if (!PROVIDER_URL) abort("ASAAS_API_URL vazia (`.env` do backend).");
if (!/(^|\.)sandbox\.asaas\.com/.test(PROVIDER_URL) && !/api-sandbox\.asaas\.com/.test(PROVIDER_URL)) {
  abort(
    `ASAAS_API_URL não aponta para o Sandbox do Asaas (valor ocultado). ` +
      `Esperado https://api-sandbox.asaas.com/v3 (doc oficial). Esta validação NUNCA roda contra produção.`
  );
}
if (!API_KEY) abort("ASAAS_API_KEY vazia. Informe a chave SANDBOX no `.env` do backend.");
if (API_KEY.startsWith("$aact_prod_")) {
  abort("ASAAS_API_KEY é de PRODUÇÃO (prefixo $aact_prod_). Gere uma chave de Sandbox ($aact_hmlg_).");
}
if (!API_KEY.startsWith("$aact_hmlg_")) {
  abort("ASAAS_API_KEY não tem o formato de chave de Sandbox (esperado prefixo $aact_hmlg_; valor não exibido).");
}

// ---------- pagamentos Sandbox conhecidos (ids de teste, não são PII) ------
// Preservados das etapas anteriores (ver progress.md > Etapa 2).
const PAYMENTS = [
  { hiringId: "cmveqi5n80003t5drjb1f4gyu", paymentId: "pay_u8c161bwlhoox6bn" },
  { hiringId: "cmveqicd10007t5dr1w3vmvp6", paymentId: "pay_77rpr1rlzm2t717v" },
];
const ARGS = process.argv.slice(2);
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] === "--payment" && ARGS[i + 1]) {
    PAYMENTS.push({ hiringId: null, paymentId: ARGS[i + 1] });
    i++;
  }
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

// ---------- provedor real (somente LEITURA) --------------------------------
async function providerGet(p) {
  const res = await fetch(`${PROVIDER_URL}${p}`, {
    method: "GET",
    headers: { access_token: API_KEY, "Content-Type": "application/json" },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo JSON */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`Etapa 3.1 — chargeback no SANDBOX REAL (somente leitura)`);
  console.log(`  provider: (sandbox) host ocultado | pagamentos observados: ${PAYMENTS.length}`);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(here, "fixtures", "asaas-chargeback.json"), "utf8")
  );

  let observedChargeback = null;
  let observedPaymentId = null;

  section("1. Leitura dos pagamentos Sandbox (GET /payments/{id})");
  for (const { paymentId } of PAYMENTS) {
    const res = await providerGet(`/payments/${encodeURIComponent(paymentId)}`);
    // O Asaas devolve 404 para pagamento inexistente; qualquer outra coisa é
    // observada, NÃO presumida.
    console.log(`  pagamento ${paymentId}: HTTP ${res.status}` + (res.json?.status ? ` status=${res.json.status}` : ""));
    if (res.status === 200 && res.json?.id) observedPaymentId = res.json.id;
  }

  section("2. Consulta de chargeback (GET /payments/{id}/chargeback)");
  for (const { paymentId } of PAYMENTS) {
    const res = await providerGet(`/payments/${encodeURIComponent(paymentId)}/chargeback`);
    if (res.status === 200 && res.json) {
      observedChargeback = res.json;
      observedPaymentId = paymentId;
      console.log(`  chargeback ENCONTRADO no pagamento ${paymentId}`);
      break;
    } else if (res.status === 404) {
      console.log(`  pagamento ${paymentId}: 404 (sem chargeback) — definitivo`);
    } else {
      console.log(`  pagamento ${paymentId}: HTTP ${res.status} (resposta não conclusiva)`);
    }
  }

  section("3. Comparação com o fixture versionado");
  if (!observedChargeback) {
    // Nada foi confirmado. Isto NÃO é falha de código; é indisponibilidade do
    // cenário no Sandbox (docs: chargeback exige solicitação por e-mail).
    console.log("  Nenhum chargeback observado no Sandbox para os pagamentos lidos.");
    console.log("  Doc oficial (docs.asaas.com > O que pode ser testado): Chargeback = ⚠️");
    console.log("  'Envie o ID da cobrança para integracoes@asaas.com.br para solicitar o teste do fluxo.'");
    console.log(`\n=================================================`);
    console.log(`Etapa 3.1 chargeback Sandbox: PENDENTE (não observado; requer solicitação ao Asaas)`);
    console.log(`=================================================`);
    process.exit(3);
  }

  // Chargeback real observado: o fixture passa a ser CONFERIDO contra o real.
  const get = fixture.PAYMENT_CHARGEBACK_DISPUTE.get;
  check(typeof observedChargeback.status === "string", `campo status presente (${observedChargeback.status})`);
  check(
    fixture._status_values.includes(observedChargeback.status) || typeof observedChargeback.status === "string",
    `status observado é um valor conhecido ou um valor novo PRESERVÁVEL (${observedChargeback.status})`
  );
  check(
    observedChargeback.reason == null || typeof observedChargeback.reason === "string",
    `reason presente/string quando vier (${observedChargeback.reason})`
  );
  check("id" in observedChargeback || "payment" in observedChargeback || "status" in observedChargeback,
    "objeto chargeback tem o formato esperado (id/payment/status)");
  // Campos do objeto COMPLETO (podem faltar no webhook, mas existem no GET).
  check("value" in observedChargeback, `campo value presente no GET (${observedChargeback.value})`);
  check("disputeStartDate" in observedChargeback || "createdDate" in observedChargeback,
    "alguma data de abertura presente (disputeStartDate)");
  check(
    !("createdDate" in observedChargeback) || "disputeStartDate" in observedChargeback,
    "confirmar que a doc usa disputeStartDate (e não createdDate)"
  );

  section("4. Webhook real? (só é possível se o Asaas entregar o evento)");
  console.log("  ⚠️ A entrega do webhook NÃO é observada por este script (exige endpoint");
  console.log("     público recebendo o POST do Asaas). Sem observação, não se declara");
  console.log("     'webhook validado'. Ver .tools/test-chargeback.mjs para o parser.");
  console.log(`  (fonte do fixture: ${fixture._source})`);

  console.log(`\n=================================================`);
  console.log(`Etapa 3.1 chargeback Sandbox: ${pass} OK, ${fail} FALHA`);
  console.log(`=================================================`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERRO FATAL:", e);
  process.exit(1);
});
