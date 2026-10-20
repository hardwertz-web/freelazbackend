import { timingSafeEqual } from "crypto";

/**
 * Cliente do provedor de pagamento ASAAS (decisão humana de migração — ver
 * findings.md > "Migração Mercado Pago → Asaas"). O Asaas foi escolhido
 * porque, ao contrário do Mercado Pago, a transferência Pix PARA TERCEIROS
 * (repasse ao profissional) é uma API autoatendível de contas padrão — o
 * maior risco técnico aberto da Fase 3.
 *
 * Padrão de integração:
 *  - Cobrança: `POST /payments` com `billingType: PIX` e o campo
 *    `customer` OBRIGATÓRIO (cliente criado via `POST /customers` na primeira
 *    cobrança de cada usuário — ver chargeService.ensureAsaasCustomerForUser);
 *    sem checkout hospedado; o QR Code vem de `GET /payments/{id}/pixQrCode`.
 *  - Webhook: o Asaas envia o corpo com um `token` que é a autenticação da
 *    notificação (ver /api/webhooks/asaas) — não depende de IP nem de
 *    assinatura HMAC.
 *  - Repasse: `POST /transfers` (Pix out para chave) — ver pixProvider.ts.
 *
 * Sem `ASAAS_API_KEY` nenhuma chamada sai: a lib lança erro explícito na
 * hora de USAR (não no import) — assim o servidor de dev sobe e as rotas
 * devolvem 503 com mensagem clara em vez de derrubar o processo.
 */

// Base URL da API do Asaas. O DEFAULT é PRODUÇÃO (correto para deploy). O
// ambiente é escolhido por ASAAS_API_URL no `.env`:
//   Sandbox : https://api-sandbox.asaas.com/v3   (doc oficial — ver findings P5)
//   Produção: https://api.asaas.com/v3
// ⚠️ P5: o `.env` deste projeto usa o formato LEGADO
// `https://sandbox.asaas.com/api/v3`, que AINDA responde (alias do Asaas), mas
// NÃO é a URL documentada. A divergência está registrada em
// .protocol/findings.md; o `.env` NÃO foi alterado (decisão do usuário).
const API_URL = process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3";

export type AsaasPayment = {
  id: string;
  status: string; // PENDING, RECEIVED, CONFIRMED, DELETED, REFUNDED...
  value: number; // em REAIS (decimal) — nunca usar float para gravar
  externalReference: string | null;
  dateCreated: string;
  paymentAddress?: string | null;
};

/**
 * Evento de webhook do Asaas, como o provedor envia (contrato oficial
 * docs.asaas.com > Webhooks). O `id` (`evt_...`) é a chave de IDEMPOTÊNCIA
 * documentada — todo o processamento é ancorado nele.
 *
 * `chargeback` (quando presente) é o objeto do processo de contestação. Os
 * valores de `status`/`reason` são repassados CRUS: a doc oficial lista
 * valores que podem evoluir e o código nunca deve traduzir/descartar um valor
 * desconhecido.
 */
export type AsaasChargeback = {
  id?: string;
  status?: string;
  reason?: string;
  value?: number; // em REAIS (decimal) — converter para centavos no parse
  // o Asaas pode devolver o valor contestado como string; aceitar ambos
  disputeStatus?: string;
  // Campos REAIS do contrato oficial (docs.asaas.com >
  // PaymentChargebackResponseDTO). `createdDate`/`updatedDate` são LEGADO
  // (nomes supostos antes da conferência da doc; o Asaas não os envia).
  disputeStartDate?: string;
  deadlineToSendDisputeDocuments?: string;
  createdDate?: string;
  updatedDate?: string;
  [key: string]: unknown;
};

export type AsaasWebhookEvent = {
  id?: string;
  event?: string;
  /**
   * ⚠️ COMPATIBILIDADE LEGADA (Etapa 3): o contrato oficial manda o segredo no
   * cabeçalho `asaas-access-token`. O campo `token` no corpo é um desvio
   * antigo do projeto e só é aceito em ambiente de TESTE — ver
   * isAuthenticAsaasWebhook. Em produção é ignorado.
   */
  token?: string;
  // O contrato REAL (docs.asaas.com) entrega o objeto `chargeback` DENTRO de
  // `payment` — por isso ele é tipado aqui.
  payment?: Partial<AsaasPayment> & { id?: string; chargeback?: AsaasChargeback | null };
  /**
   * ⚠️ COMPATIBILIDADE LEGADA: o Asaas NÃO envia `chargeback` no topo; o
   * parser aceita como fallback para payloads/testes antigos, mas prefere
   * sempre `payment.chargeback`.
   */
  chargeback?: AsaasChargeback | null;
};

export type AsaasPixQrCode = {
  encodedImage: string; // base64 do PNG do QR
  payload: string; // Pix "copia e cola"
  expirationDate: string | null;
};

export type AsaasCustomer = {
  id: string; // "cus_..." — vai no campo `customer` de POST /payments
  name?: string;
  email?: string | null;
  cpfCnpj?: string;
  mobilePhone?: string | null;
};

function apiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) {
    throw new Error(
      "ASAAS_API_KEY não definido — configure a credencial do Asaas no .env antes de criar cobranças"
    );
  }
  return key;
}

/**
 * Erro com resposta HTTP DEFINITIVA do provedor (4xx/5xx).
 *
 * A distinção é a base da reconciliação da Etapa 1: um 4xx (ex.: 404) prova que
 * o provedor NÃO criou/ENCONTRA a cobrança; já uma falha de REDE ou um timeout
 * NÃO prova nada — o resultado da chamada fica DESCONHECIDO e o fluxo nunca pode
 * criar uma segunda cobrança sem reconciliar antes.
 */
export class AsaasApiError extends Error {
  readonly status: number;
  constructor(status: number, description: string) {
    super(`Asaas: ${description}`);
    this.name = "AsaasApiError";
    this.status = status;
  }
}

async function asaasFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // fetch que REJEITA em falha de rede/timeout: o chamador precisa distinguir
  // "resposta definitiva do provedor" (AsaasApiError) de "sem resposta".
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // O Asaas devolve { errors: [{ description }] } na maioria dos erros.
    const detail =
      body && Array.isArray(body.errors) && body.errors[0]?.description
        ? body.errors[0].description
        : `HTTP ${res.status}`;
    throw new AsaasApiError(res.status, detail);
  }
  return body as T;
}

/**
 * Uma cobrança "ativa" é aquela que ainda pode ser paga: excluída (DELETED)
 * ou estornada (REFUNDED) não contam — para aquelas pode e deve existir uma
 * nova tentativa de cobrança.
 */
export function isChargeActive(status: string): boolean {
  return status !== "DELETED" && status !== "REFUNDED";
}

/**
 * Página de cobranças com o indicador de paginação do envelope OFICIAL.
 *
 * `hasMore` (docs.asaas.com > "Listagem e paginação") é a prova de
 * COMPLETUDE da consulta: `false` = fim da listagem; `true` = ainda existem
 * registros (página truncada); `null` = o provedor não devolveu o campo —
 * desvio do contrato documentado, que deve ser tratado como consulta
 * incompleta (nunca como prova de ausência).
 */
export type AsaasPaymentPage = {
  payments: AsaasPayment[];
  hasMore: boolean | null;
};

/**
 * Lista cobranças por `externalReference` — filtro DOCUMENTADO do
 * GET /payments (docs.asaas.com > Listar cobranças). É o mecanismo oficial de
 * reconciliação apontado pelo guia "Cobrança duplicada após retry sem
 * idempotência": antes de RE-CRIAR uma cobrança, consulte se a tentativa
 * anterior já produziu resultado no provedor.
 *
 * `limit=100` é o teto da API (padrão 10) e `offset` percorre páginas
 * seguintes. A AUSÊNCIA só pode ser decretada com a listagem COMPLETA —
 * ver services/chargeService.reconcile.
 */
export async function findPaymentsByExternalReference(
  externalReference: string
): Promise<AsaasPaymentPage> {
  const query = `?externalReference=${encodeURIComponent(externalReference)}&limit=100`;
  const body = await asaasFetch<{ data: AsaasPayment[]; hasMore?: boolean }>(`/payments${query}`);
  return {
    payments: Array.isArray(body?.data) ? body.data : [],
    hasMore: typeof body?.hasMore === "boolean" ? body.hasMore : null,
  };
}

/**
 * Cria o cliente na conta Asaas (POST /customers).
 *
 * O `POST /payments` é OBRIGADO a trazer o campo `customer` (docs.asaas.com >
 * Criar nova cobrança) — sem ele o provedor responde 400 `invalid_customer`.
 * Aqui vão somente dados que o usuário JÁ informou no cadastro do Freelaz
 * (nome/razão social, e-mail, CPF/CNPJ em dígitos, telefone). O id é persistido
 * em `User.asaasCustomerId` e reutilizado — ver
 * services/chargeService.ensureAsaasCustomerForUser.
 */
export async function createAsaasCustomer(input: {
  name: string;
  email: string;
  cpfCnpj: string; // somente dígitos (constraint do schema Freelaz)
  mobilePhone?: string;
}): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpfCnpj,
      ...(input.mobilePhone ? { mobilePhone: input.mobilePhone } : {}),
    }),
  });
}

/** Cria uma cobrança Pix. `valueCents` em centavos (Int) — conversão só aqui. */
export async function createPixPayment(params: {
  valueCents: number;
  externalReference: string;
  description: string;
  /**
   * OBRIGATÓRIO — campo `customer` do POST /payments (docs.asaas.com > Criar
   * nova cobrança). É o id criado por `createAsaasCustomer` e cacheado em
   * `User.asaasCustomerId`; sem ele o provedor responde 400 invalid_customer.
   */
  customerId: string;
  /**
   * ⚠️ NÃO DOCUMENTADO — best-effort, NUNCA é a proteção principal.
   * A spec atual de POST /payments (docs.asaas.com) não declara nenhum header
   * de idempotência. A proteção real contra duplicidade é APLICACIONAL: consulta
   * por `externalReference` antes de recriar + trava de concorrência no banco
   * (ver services/chargeService.ts). O header é mantido por precaução e será
   * validado no Sandbox da Etapa 2.
   */
  idempotencyKey?: string;
}): Promise<AsaasPayment> {
  if (!Number.isInteger(params.valueCents) || params.valueCents <= 0) {
    throw new Error("valueCents deve ser um inteiro positivo (centavos)");
  }
  // toFixed(2) evita notação científica/decimal fantasma; o Asaas espera
  // reais com 2 casas (199.99). A gravação no banco é sempre em centavos.
  const value = Number((params.valueCents / 100).toFixed(2));
  const today = new Date().toISOString().slice(0, 10); // yyyy-MM-dd

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers.idempotencyKey = params.idempotencyKey;
  }

  return asaasFetch<AsaasPayment>("/payments", {
    method: "POST",
    headers,
    body: JSON.stringify({
      billingType: "PIX",
      value,
      // OBRIGATÓRIO no Asaas (docs > Criar nova cobrança): cliente criado na
      // 1ª cobrança e reutilizado (ver chargeService.ensureAsaasCustomerForUser).
      customer: params.customerId,
      externalReference: params.externalReference,
      description: params.description.slice(0, 120), // limite do campo do Asaas
      dueDate: today,
    }),
  });
}

/** QR Code Pix de uma cobrança (base64 + copia e cola). */
export async function getPixQrCode(paymentId: string): Promise<AsaasPixQrCode | null> {
  // Sem QR a cobrança ainda é válida (o front pode buscar depois) — não
  // derrubamos o fluxo de criação por isso. Porém o Sandbox real (Etapa 2)
  // respondeu 400 TRANSIENTE logo após a criação numa execução, enquanto
  // chamadas idênticas imediatas seguintes deram 200: retry curto cobre o
  // solavanco, e a falha definitiva é LOGADA (id + descrição; sem credencial)
  // em vez de engolida.
  for (let attempt = 1; ; attempt++) {
    try {
      return await asaasFetch<AsaasPixQrCode>(
        `/payments/${encodeURIComponent(paymentId)}/pixQrCode`
      );
    } catch (err) {
      // Retentável: 400 (prontidão transiente observada), 5xx e falha de rede.
      // Definitivas (401/403/404...): para na hora, sem repetir.
      const retriable =
        err instanceof AsaasApiError ? err.status === 400 || err.status >= 500 : true;
      if (attempt >= 3 || !retriable) {
        const detail =
          err instanceof AsaasApiError
            ? `HTTP ${err.status} ${err.message}`
            : err instanceof Error
              ? err.message
              : "erro desconhecido";
        console.warn(`[asaas] pixQrCode indisponível para ${paymentId}: ${detail}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Busca um pagamento na API (verificação extra no webhook, quando há chave). */
export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

/**
 * Consulta o chargeback de um pagamento (GET /payments/{id}/chargeback) —
 * SOMENTE LEITURA, usada para conciliação/verificação em profundidade.
 *
 * Devolve `null` quando o provedor responde 404 (não há chargeback para este
 * pagamento — o 404 do Asaas é uma resposta DEFINITIVA). Qualquer outra falha
 * (rede, timeout, 5xx) é LANÇADA: uma consulta que falhou NUNCA pode ser lida
 * como "não existe chargeback" (a ausência de prova não é prova de ausência).
 */
export async function getPaymentChargeback(paymentId: string): Promise<{
  id?: string;
  status?: string;
  reason?: string;
  value?: number;
} | null> {
  try {
    return await asaasFetch<{ id?: string; status?: string; reason?: string; value?: number }>(
      `/payments/${encodeURIComponent(paymentId)}/chargeback`
    );
  } catch (err) {
    if (err instanceof AsaasApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Validação do token de webhook: comparação em tempo constante contra o
 * `ASAAS_WEBHOOK_TOKEN` configurado na conta Asaas. Sem token configurado,
 * NENHUMA notificação passa (assim como a assinatura HMAC do Mercado Pago).
 *
 * CONTRATO OFICIAL (docs.asaas.com > Webhooks): o Asaas envia o segredo no
 * CABEÇALHO `asaas-access-token`. A rota sempre aceita esse cabeçalho.
 *
 * COMPATIBILIDADE LEGADA (Etapa 3): versões anteriores do projeto validavam
 * `token` no CORPO. Isso foi um desvio do contrato (o evento real do Asaas
 * nunca foi exercitado com o cabeçalho). Por segurança:
 *  - em PRODUÇÃO o corpo NUNCA é aceito — só o cabeçalho oficial;
 *  - fora de produção o corpo é aceito SOMENTE em ambiente de teste
 *    explicitamente sinalizado (`NODE_ENV=test`), para os harnesses locais.
 * Nunca há caminho que contorne a validação em produção.
 *
 * Em nenhum caso o valor recebido é registrado em log.
 */
export function isValidAsaasWebhookToken(provided: string | null): boolean {
  const secret = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Autentica uma requisição de webhook do Asaas.
 *
 * Ordem:
 *  1. cabeçalho `asaas-access-token` (CONTRATO OFICIAL) — sempre aceito;
 *  2. fallback `token` do corpo — SOMENTE quando explicitamente habilitado
 *     (`allowBodyToken`), o que a rota faz apenas em ambiente de teste.
 *
 * Devolve `true` somente quando o segredo conferir em tempo constante. Token
 * vazio/ausente/inválido = `false`. Nunca loga o valor recebido.
 */
export function isAuthenticAsaasWebhook(params: {
  headerToken: string | null;
  bodyToken: string | null;
  allowBodyToken: boolean;
}): boolean {
  if (isValidAsaasWebhookToken(params.headerToken)) return true;
  if (params.allowBodyToken && isValidAsaasWebhookToken(params.bodyToken)) return true;
  return false;
}

/**
 * Transferência Pix de saída (repasse ao profissional) — a API `/transfers`
 * do Asaas é autoatendível em contas padrão (era o grande risco com o
 * Mercado Pago). Em sandbox a chamada funciona igual com credencial de
 * sandbox; em produção usa a credencial real.
 */
export async function transferPix(params: {
  pixKey: string;
  valueCents: number;
  idempotencyKey: string;
  description: string;
}): Promise<{ success: boolean; transferId?: string; errorMessage?: string }> {
  if (!Number.isInteger(params.valueCents) || params.valueCents <= 0) {
    return { success: false, errorMessage: "valor de transferência inválido" };
  }
  try {
    const transfer = await asaasFetch<{ id: string }>("/transfers", {
      method: "POST",
      // ⚠️ IDEMPOTÊNCIA — o que é e o que NÃO é garantia aqui:
      //  - O header `idempotencyKey` NÃO consta na spec atual de POST /transfers
      //    (docs.asaas.com) — é enviado por precaução (best-effort) e será
      //    verificado no Sandbox da Etapa 2. NUNCA depender dele.
      //  - O campo `transactionId` também não é documentado como mecanismo de
      //    idempotência; é mantido como identificador de conveniência.
      //  - A garantia REAL contra transferência duplicada é APLICACIONAL: o
      //    Payout já existe no nosso ledger com `idempotencyKey` única e status
      //    controlado — ver payoutService.isAlreadyProcessed (sem retry cego).
      headers: { idempotencyKey: params.idempotencyKey },
      body: JSON.stringify({
        type: "PIX",
        pixAddressKey: params.pixKey,
        value: Number((params.valueCents / 100).toFixed(2)),
        description: params.description.slice(0, 120),
        transactionId: params.idempotencyKey,
      }),
    });
    return { success: true, transferId: transfer.id };
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : "transferência recusada",
    };
  }
}
