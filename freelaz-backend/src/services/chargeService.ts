import { prisma } from "@/lib/prisma";
import {
  AsaasApiError,
  createAsaasCustomer,
  createPixPayment,
  findPaymentsByExternalReference,
  getPayment,
  isChargeActive,
  type AsaasPayment,
  type AsaasPaymentPage,
} from "@/lib/asaas";

/**
 * Coordenação de idempotência de cobrança (Etapa 1 — correção autorizada).
 *
 * Modelo: a contratação/boost é a OPERAÇÃO; cada chamada ao provedor é uma
 * TENTATIVA registrada em ChargeAttempt. Regras, em ordem:
 *
 *  1. NUNCA criar cobrança nova sem antes RECONCILAR com o provedor
 *     (GET /payments?externalReference=... — filtro documentado). O guia
 *     oficial do Asaas "Cobrança duplicada após retry sem idempotência" manda
 *     consultar o resultado anterior antes de recriar.
 *  2. Trava de concorrência no banco: uma trava advisory transacional por
 *     operação (pg_advisory_xact_lock sobre "operação = hiring.id/boost.id")
 *     serializa o CLAIM da tentativa entre requisições concorrentes; a
 *     perdedora vê a tentativa fresca da vencedora e recebe 409 SEM chamar o
 *     provedor. A unicidade UNIQUE(entity, entityId, attempt) é a última linha
 *     de defesa (P2002). Como a reconciliação acontece ANTES do claim, uma
 *     irmã que terminasse entre os dois passos ainda escaparia — por isso o
 *     claim devolve `priorConfirmed` e, nesse caso, o provedor é PERGUNTADO
 *     de novo antes de criar (janela reconcile-then-claim fechada).
 *  3. Estado ambíguo (resposta perdida, rede/5xx, crash antes de persistir) só
 *     é encerrado por prova do provedor: ou ele tem a cobrança (adotamos) ou
 *     prova que não tem (aí sim liberamos nova tentativa).
 *  4. `FALHOU`/`DELETED` no nosso banco NÃO prova que o provedor não criou
 *     nada — a reconciliação é quem decide.
 *
 * O header `idempotencyKey` enviado ao provedor é NÃO DOCUMENTADO e best-effort
 * (ver lib/asaas.ts); a proteção real é esta camada aplicacional.
 */

export type ChargeEntity = "HIRING" | "BOOST";

export type ChargeOutcome =
  | { outcome: "created"; providerPaymentId: string; status: string; attempt: number }
  | { outcome: "reused"; providerPaymentId: string; status: string }
  | { outcome: "concurrent"; message: string }
  | { outcome: "ambiguous"; message: string }
  | { outcome: "rejected"; message: string };

/**
 * Uma tentativa sem confirmação é tratada como REQUISIÇÃO EM ANDAMENTO por
 * esse período; depois disso é considerada órfã (processo morreu no meio da
 * chamada) e a reconciliação pode encerrá-la.
 */
const STALE_ATTEMPT_MS = 2 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
  );
}

function providerErrorMessage(err: unknown): string {
  if (err instanceof AsaasApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "falha de comunicação com o provedor";
}

function externalReferenceFor(entity: ChargeEntity, entityId: string): string {
  // O webhook casa por external_reference: hiring.id para contratações,
  // "boost:{id}" para destaque (formato já usado em produção de teste).
  return entity === "HIRING" ? entityId : `boost:${entityId}`;
}

function idempotencyKeyFor(entity: ChargeEntity, entityId: string, attempt: number): string {
  // A chave identifica a TENTATIVA (operação + nº), não só a entidade: retries
  // da mesma tentativa repetem a chave; uma nova tentativa legítima muda.
  const kind = entity === "HIRING" ? "payment" : "boost";
  return `freelaz:${kind}:create:${entityId}:${attempt}`;
}

/**
 * Estado do provedor para a cobrança JÁ gravada no alvo (hiring.providerPaymentId
 * / boost.providerPaymentId). Distingue "reutiliza" de "pode criar nova" de
 * "não sei — sem resposta do provedor".
 */
export async function checkPersistedCharge(
  entity: ChargeEntity,
  entityId: string
): Promise<
  | { kind: "active"; payment: AsaasPayment }
  | { kind: "stale" }
  | { kind: "ambiguous"; message: string }
> {
  const target =
    entity === "HIRING"
      ? await prisma.hiring.findUnique({ where: { id: entityId } })
      : await prisma.jobBoost.findUnique({ where: { id: entityId } });
  const providerPaymentId = target?.providerPaymentId ?? null;
  if (!providerPaymentId) return { kind: "stale" };

  let payment: AsaasPayment;
  try {
    payment = await getPayment(providerPaymentId);
  } catch (err) {
    if (err instanceof AsaasApiError && err.status === 404) {
      // O provedor não conhece mais esse id (removido do lado de lá).
      return { kind: "stale" };
    }
    // Rede/timeout/5xx: resultado DESCONHECIDO — quem decide é a reconciliação
    // por externalReference, nunca uma nova criação às cegas.
    return {
      kind: "ambiguous",
      message: `Não foi possível confirmar a cobrança existente no provedor (${providerErrorMessage(
        err
      )}) — nada foi criado; tente novamente em instantes`,
    };
  }
  if (!isChargeActive(payment.status)) return { kind: "stale" }; // excluída/estornada

  // Exclusão real no Sandbox (Etapa 2) expôs inconsistência do provedor: o
  // DELETE responde 200 {deleted:true} e a LISTAGEM por externalReference já
  // não retorna a cobrança, mas o GET-by-id continua dizendo 200/PENDING — um
  // "fantasma" que reusaríamos à força. A listagem COMPLETA (hasMore=false) é
  // a autoridade: fora dela, a cobrança não está mais vigente.
  const ref = externalReferenceFor(entity, entityId);
  let page: AsaasPaymentPage;
  try {
    page = await findPaymentsByExternalReference(ref);
  } catch (err) {
    return {
      kind: "ambiguous",
      message: `Cobrança existente aparece ativa no provedor, mas a listagem por operação falhou (${providerErrorMessage(
        err
      )}) — nada foi criado; tente novamente em instantes`,
    };
  }
  if (page.hasMore !== false) {
    return {
      kind: "ambiguous",
      message:
        "Listagem de cobranças do provedor incompleta (hasMore) — estado da cobrança existente não pode ser confirmado; nada foi criado",
    };
  }
  if (page.payments.some((p) => p.id === providerPaymentId && isChargeActive(p.status))) {
    return { kind: "active", payment };
  }
  return { kind: "stale" }; // fantasma pós-exclusão: nova tentativa é segura
}

type ReconcileResult =
  | { kind: "found"; payment: AsaasPayment }
  | { kind: "absent" }
  | { kind: "unavailable"; message: string };

/**
 * Reconcilia a operação com o provedor por `externalReference`.
 *  - Achou cobrança ATIVA: adotamos (gravamos o id no alvo) — era ela.
 *  - Provou ausência (resposta 200 COMPLETA sem cobrança ativa): nova
 *    tentativa é segura.
 *  - Sem resposta do provedor OU com listagem incompleta: estado ambíguo —
 *    a chamada deve parar aqui.
 */
async function reconcile(
  entity: ChargeEntity,
  entityId: string,
  externalReference: string
): Promise<ReconcileResult> {
  let page: AsaasPaymentPage;
  try {
    page = await findPaymentsByExternalReference(externalReference);
  } catch (err) {
    // Listagem não tem "404 = não existe"; qualquer erro aqui significa que
    // NÃO sabemos se a tentativa anterior criou cobrança.
    return {
      kind: "unavailable",
      message: `Não foi possível reconciliar com o provedor (${providerErrorMessage(
        err
      )}) — nova cobrança bloqueada para evitar duplicidade`,
    };
  }

  // Completude é pré-requisito da prova de ausência (contrato oficial:
  // docs.asaas.com > "Listagem e paginação" — `hasMore` declara se ainda
  // existem registros). `hasMore === true` = página truncada; `hasMore`
  // ausente = desvio do contrato documentado. Nos dois casos a ausência NÃO
  // está provada — poderia existir cobrança ativa fora da página lida —,
  // então a criação é interrompida como indisponível (503), nunca às cegas.
  if (page.hasMore !== false) {
    return {
      kind: "unavailable",
      message:
        "Listagem de cobranças do provedor incompleta ou fora do contrato (hasMore ausente/true) — ausência não pode ser comprovada; nada foi criado",
    };
  }

  const active = page.payments.filter((p) => isChargeActive(p.status));
  if (active.length === 0) {
    return { kind: "absent" };
  }
  // Adoção acontece no chamador, com tratamento de falha de persistência.
  return { kind: "found", payment: active[active.length - 1] };
}

/** Registra a cobrança adotada na tentativa e no alvo (hiring/boost). */
async function adoptCharge(
  entity: ChargeEntity,
  entityId: string,
  payment: AsaasPayment
): Promise<void> {
  const unresolved = await prisma.chargeAttempt.findMany({
    where: { entity, entityId, state: "PROVIDER_UNCONFIRMED" },
    orderBy: { attempt: "desc" },
  });
  if (unresolved.length > 0) {
    await prisma.chargeAttempt.update({
      where: { id: unresolved[0].id },
      data: { state: "CONFIRMED", providerPaymentId: payment.id },
    });
    if (unresolved.length > 1) {
      // Só a tentativa mais recente guarda o id (coluna única); as demais
      // ambíguas são encerradas como CONFIRMED sem id.
      await prisma.chargeAttempt.updateMany({
        where: { id: { in: unresolved.slice(1).map((a) => a.id) } },
        data: { state: "CONFIRMED" },
      });
    }
  }
  await persistToTarget(entity, entityId, payment.id);
}

/**
 * Adota a cobrança encontrada no provedor e responde "reutilizada". Se a
 * gravação no alvo falhar, a cobrança EXISTE no provedor: devolver 503
 * (ambíguo) é seguro — a próxima reconciliação a reencontra; criar nova
 * cobrança aqui seria duplicidade.
 */
async function adoptAndReuse(
  entity: ChargeEntity,
  entityId: string,
  payment: AsaasPayment
): Promise<ChargeOutcome> {
  try {
    await adoptCharge(entity, entityId, payment);
  } catch (err) {
    return {
      outcome: "ambiguous",
      message: `Cobrança vigente encontrada no provedor (${payment.id}), mas não foi possível registrá-la (${providerErrorMessage(
        err
      )}) — nada foi criado; tente novamente`,
    };
  }
  return {
    outcome: "reused",
    providerPaymentId: payment.id,
    status: payment.status,
  };
}

/**
 * Grava o id do provedor no alvo. Atualização incondicional (dentro do fluxo
 * serializado pela trava de tentativa): trocar a referência é correto tanto na
 * criação (a reconciliação já provou que a cobrança anterior não está mais
 * vigente) quanto na adoção (o provedor é a fonte de verdade sobre qual
 * cobrança está ativa agora).
 */
async function persistToTarget(
  entity: ChargeEntity,
  entityId: string,
  providerPaymentId: string
): Promise<void> {
  if (entity === "HIRING") {
    await prisma.hiring.updateMany({
      where: { id: entityId },
      data: { providerPaymentId },
    });
    return;
  }
  await prisma.jobBoost.updateMany({
    where: { id: entityId },
    data: { providerPaymentId },
  });
  // Reset defensivo: se o webhook marcou FALHOU, uma nova cobrança vigente
  // devolve o boost a PENDENTE. PAGO nunca é rebaixado.
  await prisma.jobBoost.updateMany({
    where: { id: entityId, status: "FALHOU" },
    data: { status: "PENDENTE" },
  });
}

/**
 * Requisição atômica da próxima tentativa. Retorna `null` quando existe
 * tentativa em andamento (concorrência) — nesse caso NÃO se chama o provedor.
 *
 * A serialização usa uma trava ADVISORY transacional por operação
 * (pg_advisory_xact_lock), e não só a unicidade (entity, entityId, attempt).
 * Motivo: em READ COMMITTED cada statement tem seu próprio snapshot — sem a
 * trava, a perdedora poderia ver "nenhuma tentativa" na guarda (findMany) e
 * alocar um número de tentativa DIFERENTE (aggregate) depois de a vencedora
 * commitar; como os números diferem, a unicidade não colide e as duas
 * chamadas criariam cobrança no provedor. Com a trava, a perdedora enxerga a
 * tentativa recém-commitada e recebe a trava de concorrência (409). A
 * unicidade continua como última linha de defesa (P2002 -> "concurrent").
 *
 * A trava só serializa o CLAIM; a reconciliação (GET no provedor) continua
 * fora dela. Se uma requisição irmã terminar entre o meu GET e o meu claim,
 * o claim devolve `priorConfirmed` e o chamador PERGUNTA ao provedor de novo
 * antes de criar — é o que fecha a janela reconcile-then-claim.
 *
 * A trava é liberada automaticamente no commit/rollback da transação e o
 * provedor é chamado sempre DEPOIS dela — a janela travada é só de banco.
 */
async function claimAttempt(
  entity: ChargeEntity,
  entityId: string
): Promise<{ id: string; attempt: number; priorConfirmed: boolean } | null> {
  const lockKey = `freelaz:charge-claim:${entity}:${entityId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const now = Date.now();
    // Uma única leitura (mesmo snapshot) serve de guarda E de insumo para a
    // próxima tentativa: números, órfãs e, em especial, se já houve tentativa
    // CONFIRMED nesta operação (`priorConfirmed`) — daí a decisão de
    // re-perguntar ao provedor antes de criar (fecha a janela
    // reconcile-then-claim; ver ensureCharge).
    const prior = await tx.chargeAttempt.findMany({
      where: { entity, entityId },
      orderBy: { attempt: "desc" },
    });
    const unresolved = prior.filter((a) => a.state === "PROVIDER_UNCONFIRMED");
    const priorConfirmed = prior.some((a) => a.state === "CONFIRMED");
    const fresh = unresolved.filter(
      (a) => now - a.updatedAt.getTime() < STALE_ATTEMPT_MS
    );
    if (fresh.length > 0) {
      // Requisição irmã ainda trabalhando: quem decide é ela.
      return null;
    }
    if (unresolved.length > 0) {
      // Tentativa órfã (processo morreu). A reconciliação já provou ausência
      // de cobrança no provedor antes daqui — encerra-as e segue adiante.
      await tx.chargeAttempt.updateMany({
        where: { id: { in: unresolved.map((a) => a.id) } },
        data: { state: "RECONCILED_ABSENT" },
      });
    }
    const last = await tx.chargeAttempt.aggregate({
      where: { entity, entityId },
      _max: { attempt: true },
    });
    const attempt = (last._max.attempt ?? 0) + 1;
    const created = await tx.chargeAttempt.create({
      data: { entity, entityId, attempt },
    });
    return { id: created.id, attempt: created.attempt, priorConfirmed };
  });
}

export type CustomerOutcome =
  | { kind: "ok"; customerId: string }
  | { kind: "rejected"; message: string }
  | { kind: "unavailable"; message: string };

/**
 * Garante UMA existência do usuário como cliente no provedor (Etapa 2 —
 * decisão humana "cliente por usuário"): na PRIMEIRA cobrança cria via
 * POST /customers com os dados que o usuário já cadastrou no Freelaz
 * (nome/razão social, e-mail, CPF/CNPJ, telefone) e persiste o id em
 * `User.asaasCustomerId` para reutilizar em todas as cobranças seguintes.
 *
 * Por que existe: o POST /payments do Asaas exige o campo `customer`
 * (docs.asaas.com > Criar nova cobrança); sem ele a recusa é 400
 * invalid_customer. Um cliente POR USUÁRIO (e não genérico) mantém o cadastro
 * fiel ao contratante e prepara o ambiente de produção — sem PII nova.
 *
 * Concorrência: trava advisory transacional por usuário — duas requisições
 * simultâneas na primeira cobrança não criam dois clientes; a perdedora
 * enxerga o id gravado pela vencedora (unicidade de asaasCustomerId é a
 * última linha de defesa). Chamada ao provedor acontece DENTRO da transação
 * travada; se o processo morrer após a criação e antes do commit, fica um
 * cliente órfão no provedor (inócuo — o próximo request cria outro e segue).
 *
 * Retorno não lança: `rejected` (4xx = payload recusado, nada criado),
 * `unavailable` (rede/5xx/sem resposta, nada persistido — retry refaz).
 */
export async function ensureAsaasCustomerForUser(userId: string): Promise<CustomerOutcome> {
  const select = {
    id: true,
    name: true,
    tradeName: true,
    email: true,
    document: true,
    phone: true,
    asaasCustomerId: true,
  } as const;

  // Caminho rápido (o caso de sempre): cliente já existe — sem transação.
  const existing = await prisma.user.findUnique({ where: { id: userId }, select });
  if (!existing) {
    return { kind: "rejected", message: "Usuário da cobrança não encontrado" };
  }
  if (existing.asaasCustomerId) {
    return { kind: "ok", customerId: existing.asaasCustomerId };
  }

  const lockKey = `freelaz:asaas-customer:${userId}`;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      // Sob a trava: quem chegou depois reutiliza o que a primeira gravou.
      const fresh = await tx.user.findUnique({ where: { id: userId }, select });
      if (!fresh) {
        return { kind: "rejected" as const, message: "Usuário da cobrança não encontrado" };
      }
      if (fresh.asaasCustomerId) {
        return { kind: "ok" as const, customerId: fresh.asaasCustomerId };
      }

      let created;
      try {
        created = await createAsaasCustomer({
          name: fresh.tradeName ?? fresh.name,
          email: fresh.email,
          cpfCnpj: fresh.document, // schema garante somente dígitos
          mobilePhone: fresh.phone,
        });
      } catch (err) {
        if (err instanceof AsaasApiError && err.status >= 400 && err.status < 500) {
          // Recusa definitiva do payload do cliente: nada foi criado.
          return {
            kind: "rejected" as const,
            message: `O provedor recusou o cadastro do cliente (${providerErrorMessage(err)})`,
          };
        }
        // Rede/5xx/timeout: sem resposta = sem persistência — retry refaz.
        return {
          kind: "unavailable" as const,
          message: `Não foi possível cadastrar o cliente no provedor (${providerErrorMessage(
            err
          )}) — nada foi cobrado; tente novamente em instantes`,
        };
      }

      const saved = await tx.user.update({
        where: { id: userId },
        data: { asaasCustomerId: created.id },
        select: { asaasCustomerId: true },
      });
      return { kind: "ok" as const, customerId: saved.asaasCustomerId! };
    });
  } catch (err) {
    // Corrida residual: outra transação persistiu o id primeiro — reutiliza.
    if (isUniqueViolation(err)) {
      const again = await prisma.user.findUnique({
        where: { id: userId },
        select: { asaasCustomerId: true },
      });
      if (again?.asaasCustomerId) return { kind: "ok", customerId: again.asaasCustomerId };
    }
    return {
      kind: "unavailable",
      message: `Não foi possível registrar o cliente no provedor (${providerErrorMessage(
        err
      )}) — nada foi cobrado; tente novamente em instantes`,
    };
  }
}

/**
 * Garante UMA cobrança vigente para a operação, criando-a apenas quando isso
 * é seguro. Nunca duplica: reconcilia antes, trava a concorrência no banco e
 * trata estado ambíguo como parada obrigatória.
 */
export async function ensureCharge(params: {
  entity: ChargeEntity;
  entityId: string;
  valueCents: number;
  description: string;
  /** Cliente no provedor (campo obrigatório `customer` do POST /payments). */
  customerId: string;
}): Promise<ChargeOutcome> {
  const { entity, entityId } = params;
  const externalReference = externalReferenceFor(entity, entityId);

  // 1) Reconciliação com o provedor — a única fonte de verdade sobre "já existe?".
  const reconciled = await reconcile(entity, entityId, externalReference);
  if (reconciled.kind === "unavailable") {
    return { outcome: "ambiguous", message: reconciled.message };
  }
  if (reconciled.kind === "found") {
    return adoptAndReuse(entity, entityId, reconciled.payment);
  }

  // 2) Trava atômica da tentativa (sem ela o provedor nunca é chamado).
  let attempt: { id: string; attempt: number; priorConfirmed: boolean } | null;
  try {
    attempt = await claimAttempt(entity, entityId);
  } catch (err) {
    // Violação de unicidade dentro da transação: outra requisição acabou de
    // reivindicar a tentativa — mesma conclusão do `null` (concorrência).
    if (isUniqueViolation(err)) {
      return {
        outcome: "concurrent",
        message:
          "Já existe uma tentativa de cobrança em andamento para esta operação — tente novamente em instantes",
      };
    }
    throw err;
  }
  if (!attempt) {
    return {
      outcome: "concurrent",
      message:
        "Já existe uma tentativa de cobrança em andamento para esta operação — tente novamente em instantes",
    };
  }

  // 2b) Re-reconciliação CONDICIONAL. Se já houve tentativa CONFIRMED nesta
  //     operação mas a reconciliação inicial disse "ausente", duas leituras
  //     são possíveis: (a) a cobrança foi encerrada no provedor (DELETED/
  //     REFUNDED) — nova tentativa é legítima; (b) uma requisição irmã terminou
  //     DEPOIS do meu GET e ANTES do meu claim (a trava serializa o claim, mas
  //     não o GET) — criar agora seria duplicidade. Perguntar ao provedor fecha
  //     a janela: achou → adota; não achou → cria; sem resposta → para.
  if (attempt.priorConfirmed) {
    const recheck = await reconcile(entity, entityId, externalReference);
    if (recheck.kind === "unavailable") {
      await prisma.chargeAttempt
        .update({ where: { id: attempt.id }, data: { lastError: recheck.message } })
        .catch(() => undefined);
      return { outcome: "ambiguous", message: recheck.message };
    }
    if (recheck.kind === "found") {
      return adoptAndReuse(entity, entityId, recheck.payment);
    }
  }

  // 3) Criação no provedor. Qualquer falha que NÃO seja recusa definitiva
  //    (4xx) deixa a tentativa PROVIDER_UNCONFIRMED — estado ambíguo, que só a
  //    reconciliação do próximo request pode encerrar.
  let payment: AsaasPayment;
  try {
    payment = await createPixPayment({
      valueCents: params.valueCents,
      customerId: params.customerId,
      externalReference,
      description: params.description,
      idempotencyKey: idempotencyKeyFor(entity, entityId, attempt.attempt),
    });
  } catch (err) {
    if (err instanceof AsaasApiError && err.status >= 400 && err.status < 500) {
      // 4xx = requisição recusada: o provedor NÃO criou a cobrança.
      await prisma.chargeAttempt.update({
        where: { id: attempt.id },
        data: { state: "REJECTED", lastError: providerErrorMessage(err) },
      });
      return {
        outcome: "rejected",
        message: `O provedor recusou a cobrança (${providerErrorMessage(err)})`,
      };
    }
    // Rede/timeout/5xx: o provedor PODE ter criado. Fica ambíguo de propósito.
    await prisma.chargeAttempt
      .update({ where: { id: attempt.id }, data: { lastError: providerErrorMessage(err) } })
      .catch(() => undefined);
    return {
      outcome: "ambiguous",
      message: `Resultado da criação da cobrança DESCONHECIDO (${providerErrorMessage(
        err
      )}) — nada foi confirmado; a próxima tentativa reconcilia com o provedor antes de criar`,
    };
  }

  // 4) Persistência: primeiro a tentativa (sobrevive a falha de gravação no
  //    alvo), depois o alvo. Se a gravação no alvo falhar, a cobrança JÁ EXISTE
  //    no provedor e a próxima requisição a reencontra na reconciliação.
  await prisma.chargeAttempt.update({
    where: { id: attempt.id },
    data: { state: "CONFIRMED", providerPaymentId: payment.id },
  });
  try {
    await persistToTarget(entity, entityId, payment.id);
  } catch (err) {
    return {
      outcome: "ambiguous",
      message: `Cobrança criada no provedor (${payment.id}), mas houve falha ao registrá-la (${providerErrorMessage(
        err
      )}) — a próxima tentativa reconcilia com o provedor e a reutiliza, sem duplicar`,
    };
  }

  return {
    outcome: "created",
    providerPaymentId: payment.id,
    status: payment.status,
    attempt: attempt.attempt,
  };
}
