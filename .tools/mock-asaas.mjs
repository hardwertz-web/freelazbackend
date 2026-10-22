// Mock do provedor Asaas para os testes da Etapa 1 (idempotência de cobrança).
//
// Rodeia em porta local (4010) e implementa o suficiente de /v3/payments para
// exercitar as rotas reais do backend com respostas CONTROLADAS:
//   POST /v3/customers                       cria cliente (o POST /payments
//                                            exige o campo `customer` — a
//                                            ausência vira 400 invalid_customer
//                                            como no provedor real)
//   GET  /v3/customers/{id}                  consulta cliente
//   POST /v3/payments                        cria cobrança
//   GET  /v3/payments?externalReference=... lista (filtro documentado)
//   GET  /v3/payments/{id}                   consulta
//   GET  /v3/payments/{id}/pixQrCode         QR Code
//
// Controle dos testes (fora do contrato Asaas, prefixo /__):
//   POST /__scenario  { createMode, createDelayMs, forcedId, listMode }
//   POST /__scenario  { setPaymentStatus: { id, status } }
//   GET  /__state     estado + contadores
//   POST /__reset     zera tudo
//
// NENHUM dinheiro é movimentado e nenhuma credencial real é usada aqui.
import http from "node:http";

const PORT = Number(process.env.MOCK_ASAAS_PORT ?? 4010);

const state = {
  payments: new Map(), // id -> payment
  customers: new Map(), // id -> customer (POST /payments exige `customer`)
  subaccounts: new Map(), // id -> subconta (Etapa 7.3b)
  counter: 0,
  customerCounter: 0,
  subaccountCounter: 0,
  calls: {
    create: 0,
    list: 0,
    get: 0,
    qr: 0,
    createCustomer: 0,
    getCustomer: 0,
    createSubaccount: 0,
    getSubaccount: 0,
  },
  scenario: {
    // ok        -> cria e responde normalmente
    // drop      -> CRIA a cobrança e derruba a conexão sem responder
    //             (simula resposta perdida: o provedor criou, nós não sabemos)
    // fail500   -> responde 500 SEM criar (erro do provedor)
    // forced_id -> cria com o id forçado em `forcedId` (simula falha de
    //             persistência no nosso banco por violação de unicidade)
    createMode: "ok",
    createDelayMs: 0,
    forcedId: null,
    // listMode:
    //   ok         -> lista normal, com a paginação real do contrato
    //                  (limit padrão 10/máx. 100, offset e hasMore)
    //   fail500    -> GET /v3/payments indisponível (indisponibilidade da
    //                  consulta)
    //   incomplete -> página truncada: devolve hasMore=true mesmo quando não
    //                  existem mais registros (simula resposta incompleta —
    //                  a ausência não pode ser comprovada)
    listMode: "ok",
  },
};

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function createPayment({ value, externalReference, customer, id, split }) {
  state.counter += 1;
  const payment = {
    id: id ?? `pay_mock_${state.counter}_${Date.now()}`,
    status: "PENDING",
    value: value ?? 0,
    externalReference: externalReference ?? null,
    customer: customer ?? null,
    dateCreated: new Date().toISOString(),
    paymentAddress: null,
    // Etapa 7.3c: ecoa o split recebido (somente rastreamento no mock).
    split: Array.isArray(split) && split.length > 0 ? split : null,
  };
  state.payments.set(payment.id, payment);
  return payment;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // ---- controle dos testes --------------------------------------------
  if (path === "/__state" && req.method === "GET") {
    return send(res, 200, {
      calls: state.calls,
      scenario: state.scenario,
      payments: [...state.payments.values()],
      customers: [...state.customers.values()],
      subaccounts: [...state.subaccounts.values()],
    });
  }
  if (path === "/__reset" && req.method === "POST") {
    state.payments.clear();
    state.customers.clear();
    state.subaccounts.clear();
    state.counter = 0;
    state.customerCounter = 0;
    state.subaccountCounter = 0;
    state.calls = {
      create: 0,
      list: 0,
      get: 0,
      qr: 0,
      createCustomer: 0,
      getCustomer: 0,
      createSubaccount: 0,
      getSubaccount: 0,
    };
    state.scenario = {
      createMode: "ok",
      createDelayMs: 0,
      forcedId: null,
      listMode: "ok",
    };
    return send(res, 200, { ok: true });
  }
  if (path === "/__scenario" && req.method === "POST") {
    const body = await readBody(req);
    if (body.setPaymentStatus) {
      const p = state.payments.get(body.setPaymentStatus.id);
      if (p) p.status = body.setPaymentStatus.status;
    }
    // Semeia/atualiza um pagamento arbitrário (testes de webhook da Etapa 3):
    // o backend com ASAAS_API_KEY reconsulta GET /payments/{id} — o objeto
    // precisa existir e refletir o status real esperado.
    if (body.seedPayment) {
      const s = body.seedPayment;
      state.payments.set(s.id, {
        id: s.id,
        status: s.status ?? "CONFIRMED",
        value: s.value ?? 0,
        externalReference: s.externalReference ?? null,
        customer: s.customer ?? null,
        dateCreated: new Date().toISOString(),
        paymentAddress: null,
      });
    }
    for (const key of ["createMode", "createDelayMs", "forcedId", "listMode"]) {
      if (key in body) state.scenario[key] = body[key];
    }
    return send(res, 200, { ok: true, scenario: state.scenario });
  }

  // ---- contrato Asaas (o que o backend usa) ---------------------------
  if (!req.headers.access_token) {
    return send(res, 401, { errors: [{ description: "Token inválido" }] });
  }

  if (path === "/v3/customers" && req.method === "POST") {
    state.calls.createCustomer += 1;
    const body = await readBody(req);
    // Contrato real: `name` e `cpfCnpj` são obrigatórios para criar cliente
    // (docs.asaas.com > Criar novo cliente); sem eles, 400 com o envelope
    // { errors: [{ description }] } que a lib real traduz em AsaasApiError.
    if (!body.name || !body.cpfCnpj) {
      return send(res, 400, {
        errors: [{ description: "Os campos name e cpfCnpj são obrigatórios.", code: "invalid_customer" }],
      });
    }
    state.customerCounter += 1;
    const customer = {
      id: `cus_mock_${state.customerCounter}_${Date.now()}`,
      dateCreated: new Date().toISOString(),
      name: body.name,
      email: body.email ?? null,
      cpfCnpj: body.cpfCnpj,
      mobilePhone: body.mobilePhone ?? null,
    };
    state.customers.set(customer.id, customer);
    return send(res, 201, customer);
  }

  const customerMatch = path.match(/^\/v3\/customers\/([^/]+)$/);
  if (customerMatch && req.method === "GET") {
    state.calls.getCustomer += 1;
    const customer = state.customers.get(customerMatch[1]);
    if (!customer) return send(res, 404, { errors: [{ description: "Cliente não encontrado" }] });
    return send(res, 200, customer);
  }

  // ---- Subcontas (Etapa 7.3b) -----------------------------------------
  // Contrato real: POST /v3/accounts devolve `accessToken.apiKey` SOMENTE na
  // criação; GET /v3/accounts/{id} nunca devolve a chave.
  if (path === "/v3/accounts" && req.method === "POST") {
    state.calls.createSubaccount += 1;
    const body = await readBody(req);
    const required = [
      "name",
      "email",
      "cpfCnpj",
      "mobilePhone",
      "incomeValue",
      "address",
      "addressNumber",
      "province",
      "postalCode",
    ];
    const missing = required.filter(
      (key) =>
        body[key] === undefined ||
        body[key] === null ||
        (typeof body[key] === "string" && body[key].trim() === "")
    );
    if (missing.length > 0) {
      return send(res, 400, {
        errors: [
          {
            description: `Campos obrigatórios ausentes: ${missing.join(", ")}.`,
            code: "invalid_subaccount",
          },
        ],
      });
    }
    if (String(body.postalCode).replace(/\D/g, "").length !== 8) {
      return send(res, 400, {
        errors: [{ description: "postalCode inválido.", code: "invalid_postalCode" }],
      });
    }
    // `companyType` é opcional e só existe para PJ; valores são os do enum
    // oficial (AccountSaveRequestCompanyType).
    const companyTypes = ["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"];
    if (body.companyType !== undefined && !companyTypes.includes(body.companyType)) {
      return send(res, 400, {
        errors: [{ description: "companyType inválido.", code: "invalid_companyType" }],
      });
    }
    state.subaccountCounter += 1;
    const id = `acc_mock_${state.subaccountCounter}_${Date.now()}`;
    const isPj = String(body.cpfCnpj).replace(/\D/g, "").length > 11;
    const account = {
      id,
      walletId: `wallet_mock_${state.subaccountCounter}`,
      status: "PENDING",
      name: body.name,
      email: body.email,
      cpfCnpj: body.cpfCnpj,
      personType: isPj ? "JURIDICA" : "FISICA",
      companyType: isPj ? body.companyType ?? null : null,
      // A doc devolve `tradingName` preenchido automaticamente; não é campo
      // de entrada de POST /v3/accounts.
      tradingName: null,
      incomeValue: body.incomeValue,
      address: body.address,
      addressNumber: body.addressNumber,
      province: body.province,
      postalCode: body.postalCode,
      birthDate: body.birthDate ?? null,
    };
    // Guarda a chave fora do objeto retornável pelo GET.
    const apiKey = `aact_mock_sub_${state.subaccountCounter}_${Date.now()}`;
    state.subaccounts.set(id, { account, apiKey });
    return send(res, 201, { ...account, accessToken: { apiKey } });
  }

  const subaccountMatch = path.match(/^\/v3\/accounts\/([^/]+)$/);
  if (subaccountMatch && req.method === "GET") {
    state.calls.getSubaccount += 1;
    const entry = state.subaccounts.get(subaccountMatch[1]);
    if (!entry) return send(res, 404, { errors: [{ description: "Subconta não encontrada" }] });
    return send(res, 200, entry.account);
  }

  if (path === "/v3/payments" && req.method === "POST") {
    state.calls.create += 1;
    const body = await readBody(req);
    // Contrato real (docs.asaas.com > Criar nova cobrança): `customer` é
    // OBRIGATÓRIO e precisa existir — recusa 400 invalid_customer ANTES de
    // qualquer processamento, exatamente como o provedor faz.
    if (!body.customer) {
      return send(res, 400, {
        errors: [{ description: "O campo customer é obrigatório.", code: "invalid_customer" }],
      });
    }
    if (!state.customers.has(body.customer)) {
      return send(res, 400, {
        errors: [{ description: "Cliente não encontrado (campo customer).", code: "invalid_customer" }],
      });
    }
    // Split (Etapa 7.3c): quando presente, TODOS os walletId precisam existir
    // entre as subcontas criadas neste mock. Contrato real: wallet inválido é
    // recusa definitiva (400), nada é criado.
    if (body.split !== undefined) {
      if (!Array.isArray(body.split)) {
        return send(res, 400, {
          errors: [{ description: "split deve ser uma lista.", code: "invalid_split" }],
        });
      }
      const knownWallets = new Set(
        [...state.subaccounts.values()].map((entry) => entry.account.walletId)
      );
      for (const item of body.split) {
        if (!item || typeof item.walletId !== "string" || !knownWallets.has(item.walletId)) {
          return send(res, 400, {
            errors: [{ description: "walletId do split não encontrado.", code: "invalid_split_wallet" }],
          });
        }
        if (
          typeof item.percentualValue !== "number" ||
          !Number.isFinite(item.percentualValue) ||
          item.percentualValue <= 0 ||
          item.percentualValue > 100
        ) {
          return send(res, 400, {
            errors: [{ description: "percentualValue inválido no split.", code: "invalid_split_percentual" }],
          });
        }
      }
      // Doc oficial: para splits exclusivamente percentuais a soma NÃO pode
      // ultrapassar 100%. Menos que 100% é válido: o restante permanece na
      // conta que criou a cobrança. O mock reproduz essa rejeição.
      const totalPercent = body.split.reduce(
        (sum, item) => sum + (typeof item?.percentualValue === "number" ? item.percentualValue : 0),
        0
      );
      if (totalPercent > 100) {
        return send(res, 400, {
          errors: [
            {
              description: "Soma dos percentuais do split ultrapassa 100%.",
              code: "invalid_split_total",
            },
          ],
        });
      }
    }
    const { createMode, createDelayMs, forcedId } = state.scenario;
    if (createDelayMs > 0) await new Promise((r) => setTimeout(r, createDelayMs));

    if (createMode === "fail500") {
      return send(res, 500, { errors: [{ description: "Erro interno simulado do provedor" }] });
    }
    // Em todos os modos restantes a cobrança É criada no provedor.
    const payment = createPayment({
      value: body.value,
      externalReference: body.externalReference,
      customer: body.customer,
      id: createMode === "forced_id" ? forcedId : undefined,
      split: body.split,
    });
    if (createMode === "drop") {
      // Resposta perdida: o provedor criou, mas o cliente nunca recebe nada.
      req.socket.destroy();
      return undefined;
    }
    return send(res, 201, payment);
  }

  if (path === "/v3/payments" && req.method === "GET") {
    state.calls.list += 1;
    if (state.scenario.listMode === "fail500") {
      return send(res, 500, { errors: [{ description: "Consulta indisponível (simulado)" }] });
    }
    const externalReference = url.searchParams.get("externalReference");
    // Exclusão real (Etapa 2, Sandbox): cobrança com DELETE some da LISTAGEM,
    // mas o GET-by-id continua devolvendo-a com o status anterior (fantasma).
    const all = [...state.payments.values()].filter(
      (p) => !p.deleted && (!externalReference || p.externalReference === externalReference)
    );
    // Contrato oficial (docs.asaas.com > Listagem e paginação): limit
    // (padrão 10, máx. 100), offset e o indicador `hasMore` no envelope.
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
    const rawOffset = Number(url.searchParams.get("offset"));
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const page = all.slice(offset, offset + limit);
    let hasMore = offset + page.length < all.length;
    if (state.scenario.listMode === "incomplete") {
      // Página truncada simulada: o provedor devolve parte dos registros com
      // hasMore=true — o cliente NÃO pode decretar ausência.
      hasMore = true;
    }
    return send(res, 200, { data: page, totalCount: all.length, limit, offset, hasMore });
  }

  const qrMatch = path.match(/^\/v3\/payments\/([^/]+)\/pixQrCode$/);
  if (qrMatch && req.method === "GET") {
    state.calls.qr += 1;
    const payment = state.payments.get(qrMatch[1]);
    if (!payment) return send(res, 404, { errors: [{ description: "Cobrança não encontrada" }] });
    return send(res, 200, {
      encodedImage: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      payload: `000201mock-${payment.id}`,
      expirationDate: null,
    });
  }

  const paymentMatch = path.match(/^\/v3\/payments\/([^/]+)$/);
  if (paymentMatch && req.method === "GET") {
    state.calls.get += 1;
    const payment = state.payments.get(paymentMatch[1]);
    if (!payment) return send(res, 404, { errors: [{ description: "Cobrança não encontrada" }] });
    return send(res, 200, payment);
  }

  if (paymentMatch && req.method === "DELETE") {
    state.calls.delete = (state.calls.delete || 0) + 1;
    const payment = state.payments.get(paymentMatch[1]);
    if (!payment) return send(res, 404, { errors: [{ description: "Cobrança não encontrada" }] });
    // Contrato REAL observado no Sandbox (Etapa 2): DELETE responde
    // {deleted:true}; a cobrança É RETIRADA da listagem, mas o GET-by-id
    // continua respondendo 200 com o status anterior ("fantasma"). Reproduzir
    // isso aqui trava localmente a correção do checkPersistedCharge (que
    // passou a tratar a listagem completa como autoridade).
    payment.deleted = true;
    return send(res, 200, { deleted: true, id: payment.id });
  }

  return send(res, 404, { errors: [{ description: `Rota não implementada no mock: ${req.method} ${path}` }] });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      try {
        send(res, 500, { errors: [{ description: `mock: ${err?.message ?? "erro"}` }] });
      } catch {
        /* socket já morto */
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`mock-asaas ouvindo em http://127.0.0.1:${PORT}/v3`);
  });
