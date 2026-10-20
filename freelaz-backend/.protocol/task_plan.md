# task_plan.md — Freelaz

Fases e checklist. Marque `[x]` conforme for concluindo — isso é o que qualquer agente (ou você mesmo, voltando depois de um tempo) lê primeiro para saber onde continuar.

## Fase 1 — Fundação
- [x] **Fase 1 validada ponta a ponta em banco real (35/35 assertions)** — `.tools/run-all-tests.ps1`
- [x] Autenticação (cadastro único CPF/CNPJ, login, recuperação de senha) — `src/app/api/auth/*`
- [x] Papéis ativáveis (Profissional / Contratante) por conta — `UserRoleAssignment.status`
- [x] Modelo de dados completo (`schema.prisma`)
- [x] CRUD básico de perfil (profissional e contratante) — `src/app/api/profile/*`
- [x] Verificação de identidade (documento + selfie / CNPJ) — `src/app/api/verification/*`
- [x] Bloqueio de cadastro para menores de 18 anos — `src/lib/document.ts`
- [x] Sessão e autorização nas rotas que já existiam (retrofit — antes qualquer um chamava)
- [x] Aprovação da verificação por painel — `/admin`, aba **Identidade** (Fase 5); sem painel, o mesmo efeito é obtido à mão no Prisma Studio
- [ ] Confirmação de telefone (depende de provedor SMS/WhatsApp — Fase 6)
- [ ] Tela de cadastro/login (front) — depende do protótipo visual, que não está na máquina

## Fase 2 — Loop central do marketplace (sem dinheiro real)
- [x] **Fase 2 validada ponta a ponta em banco real (112/112 assertions)** — `.tools/run-all-tests.ps1`
- [x] Publicar vaga pública + listar/buscar/filtrar no marketplace (`GET/POST /api/jobs`)
- [x] Detalhe, edição e cancelamento (soft delete) da vaga (`GET/PATCH/DELETE /api/jobs/[id]`)
- [x] Candidatar-se a uma vaga (`POST /api/jobs/[id]/apply`) e listar candidaturas (`GET /api/jobs/[id]/applications`, `GET /api/applications`)
- [x] Criar o `Hiring` (`AGUARDANDO_PAGAMENTO`) no aceite/seleção — `selectCandidate` chama `createHiringForApplication`, idempotente por `applicationId`
- [x] Seleção de candidato + lista de suplentes automática (`jobPostingService.ts`)
- [x] "Me contrate" — convite direto com contraproposta (`/api/jobs/invite`, `/api/applications/[id]/counter-offer`, `/api/applications/[id]/respond`)
- [x] Chat vinculado à contratação, derivado do status do Hiring (bloqueado até o pagamento, aberto durante o serviço, encerrado no fim) — `chatService.ts` + `/api/hirings/[id]/chat`
- [x] "Minhas contratações" dos dois lados (`GET /api/hirings`, `GET /api/hirings/[id]`)
- [x] Filtro de suplentes por conflito de agenda — validado com dado real
- [x] Transição `RETIDO → EM_ANDAMENTO` (o turno começou) — gatilho confirmado: o código de abertura digitado pela empresa (`markOpeningCodeUsed`); o agendador que gera os códigos veio adiantado da Fase 4
- [ ] Tela do marketplace (front) — depende do protótipo visual, que não está na máquina

## Fase 3 — Dinheiro
- [x] **Fase 3 validada ponta a ponta em banco real (103/103 assertions)** — `.tools/run-all-tests.ps1` (bateria total do projeto: ver Fase 4)
- [x] Integração Asaas (migração decidida sobre o Mercado Pago, dados preservados) — criação de cobrança Pix idempotente (`/api/payments/create`; **503 sem `ASAAS_API_KEY`** — nada de sucesso simulado)
- [x] Webhook de pagamento (retenção + atualização de status da vaga) (`/api/webhooks/asaas`) — autenticado por `token` timing-safe; com credencial, rebusca o pagamento na API antes de agir; trava de concorrência (lock + índice único de retenção) contra duplicidade
- [x] Ledger interno (retenção, liberação, reembolso) (`ledgerService.ts`)
- [x] Service de repasse (`payoutService.ts`) — Pix de saída via `/transfers` do Asaas (autoatendível em conta padrão). **Produção pendente de habilitação:** chave real + teste de transferência de baixo valor antes do lote semanal (ver `findings.md`)
- [x] Provedor de transferência atrás de interface plugável (`pixProvider.ts`) — sandbox em dev (`PAYOUT_SANDBOX=1`), placeholder que RECUSA em produção
- [x] Carteira/extrato do profissional (rota de leitura; **tela bloqueada** pelo protótipo visual ausente) — `GET /api/wallet` + `walletService.ts`
- [x] Saque instantâneo (rota + taxa configurável) — `POST /api/wallet/withdraw`, taxa via `INSTANT_WITHDRAWAL_FEE_BPS` (hoje 100 bps = 1%, **PLACEHOLDER a confirmar com o produto**)
- [x] Job agendado de repasse semanal em lote — `POST /api/cron/payouts` + `processPendingPayouts()`
- [x] Job agendado de reconciliação diária — `POST /api/cron/reconciliation` + `runReconciliation()` (5 invariantes)
- [x] Lacuna `RETIDO → EM_ANDAMENTO` fechada (`markOpeningCodeUsed`) + agendador de códigos de turno adiantado da Fase 4 (`POST /api/cron/shift-codes`)

## Fase 4 — Confiança e segurança
- [x] **Fase 4 validada ponta a ponta em banco real (202/202 assertions)** — `.tools/run-all-tests.ps1`
- [x] Avaliação mútua (1-5 estrelas + comentário; liberação 2h após o uso do código de fechamento) — `evaluationService.ts` + `POST/GET /api/evaluations`
- [x] Confiabilidade (métrica separada da nota: % de conclusões limpas nas últimas 20 contratações terminais, recalculada em cada transição terminal) — `reliabilityService.ts` + `ProfessionalProfile.reliabilityScore`
- [x] Geração de código de abertura/fechamento nos horários certos (`codeService.ts` + agendador `POST /api/cron/shift-codes`, entregue antecipado na Fase 3 — falta só notificar o profissional com o código, push/WhatsApp é Fase 6)
- [x] Limite de tentativas de código (5 por contratação/tipo) com auditoria `CodeAttempt`
- [x] Check-in por geolocalização (evidência do profissional; não bloqueia a digitação do código) — `checkInService.ts` + `POST/GET /api/hirings/[id]/check-in`
- [x] Cancelamento — caminho único com reembolso de 100% via ledger (`matchService.ts`/`hiringService.ts`; multas ficam para o produto definir)
- [x] Liberação condicionada: janela de 2h após o código de fechamento + sem disputa aberta (gate em `releasePayout`)
- [x] Disputa (canal + evidências + decisão administrativa: devolução total, liberação total ou divisão) — `disputeService.ts` + `POST/GET /api/hirings/[id]/dispute` + rotas `admin/disputes*` (header `x-internal-secret`, `adminId` auditado)
- [x] Denúncia de comportamento abusivo (fila separada e prioritária, ABUSO nasce ALTA; nunca move dinheiro) — `reportService.ts` + `POST/GET /api/reports` + rotas `admin/reports*`
- [x] Migração `20261016214500_fase4_confianca_asaas` (avaliações, check-in, disputas, evidências, denúncias, `CodeAttempt`, índices únicos parciais de contratação viva/disputa aberta/retenção)

## Fase 5 — Monetização avançada e admin
- [x] **Painel administrativo mínimo validado ponta a ponta em banco real (145/145 assertions)** — `.tools/test-fase5.ps1` (passo 7/7 da bateria). UI em `/admin` (client-side, sem biblioteca nova) com login por sessão e abas Disputas / Denúncias / Identidade / Financeiro
- [x] Autorização das rotas `/api/admin/*` por **segredo interno OU sessão com papel `ADMIN` ativo** (`checkAdminAccess`); `adminId` auditado = id da sessão no caminho do painel
- [x] Aprovação manual de identidade pelo painel (transação: `VERIFICADO` + papel `ATIVO` + perfil `VERIFICADO`, com `decidedById`) e rejeição com motivo (permite reenvio) — substitui a aprovação à mão no Prisma Studio
- [x] Fila de disputas/denúncias **enriquecida** (partes com documento mascarado, lado que abriu, autoria das evidências)
- [x] Consultas financeiras (contratações, repasses, ledger), reconciliação **ao vivo** (leitura pura) e disparo do **lote de repasses** pelo painel (mesmo serviço do cron) — dinheiro só sai pelo ledger auditado
- [x] `GET /api/uploads/[...path]` libera `verifications/` e `private/` para papel `ADMIN` (provas do painel), sem afetar o dono (401 anônimo / 403 terceiro)
- [x] `JobBoost` — impulsionamento pago "Publicar com urgência" (`/api/jobs/boost`)
- [ ] Persistência do relatório de reconciliação (hoje o painel consulta ao vivo, sem histórico)
- [ ] Plano CLT (assinatura + regras de acesso a vaga CLT)
- [ ] Configurações financeiras editáveis pelo admin (tabela de comissão, valor do plano, valor do boost)
- [ ] Painel administrativo com as métricas (GMV, conversão, cancelamento, etc.)

## Pós-auditoria — Etapa 1 (idempotência de cobrança) — correção autorizada
- [x] Migração `20261017150000_etapa1_idempotencia` (100% aditiva; impacto e reversão apresentados e autorizados antes de aplicar): tabela `ChargeAttempt` com `UNIQUE(entity, entityId, attempt)` e índice único `JobBoost.jobPostingId`
- [x] `src/services/chargeService.ts`: reconciliação por `externalReference` **antes de criar**, trava atômica de tentativa, estado ambíguo (`PROVIDER_UNCONFIRMED`) que **nunca** cria cobrança sem prova do provedor, adoção de cobrança vigente, chave por tentativa (`freelaz:payment:create:{hiringId}:{n}`)
- [x] `/api/payments/create` e `/api/jobs/boost` redesenhadas sobre o serviço (503 sem credencial intacto; respostas novas: 409 concorrência, 503 ambíguo, 502 recusa do provedor)
- [x] `src/lib/asaas.ts`: `AsaasApiError` com status HTTP (4xx = recusa definitiva ≠ rede/timeout = desconhecido), `findPaymentsByExternalReference` (filtro documentado) **expondo `hasMore`**, comentário de `transferPix` corrigido, header `idempotencyKey` documentado como **não verificado/best-effort**
- [x] Guard de completude da listagem: `reconcile()` só decreta ausência com `hasMore === false` (truncada/ausente → 503, nada criado); `.tools/mock-asaas.mjs` atualizado para reproduzir o contrato real (`limit` padrão 10/máx. 100, `offset`, `hasMore`/`totalCount`) + modo `listMode: "incomplete"`
- [x] Bateria nova `.tools/test-idempotencia.ps1` (passo 8/8) com mock do Asaas controlado — **10 cenários, 77/77** (inclui listagem incompleta); nenhum teste existente alterado
- [x] **Validação local concluída:** `tsc --noEmit` e `npm run build` exit 0; bateria completa `run-all-tests.ps1` exit **0** (674/674 = 597 + 77); **3 repetições** do harness com logs/exits próprios (0/0/0, 77/77 cada); conferência independente do banco pós-execução (nenhum payment id em duas `CONFIRMED`, alvos coerentes com a última tentativa, unicidade `(entity,entityId,attempt)` intacta; ledger/histórico preservados — cenário 9 verde)
- [x] **Etapa 1 (idempotência de cobrança) — `APROVADA COM RESSALVAS` (fechamento aprovado em 2026-10-19 — ver Sessão 17 do `progress.md`).** A correção foi implementada, validada localmente e a **revisão humana do diff foi concluída sem bloqueador crítico**. Critérios **originais** de liberação (Sessão 10) — mantidos como histórico; a definição de fechamento foi reformulada na Sessão 16 e **aprovada formalmente agora**: (1) revisão humana do diff; (2) execução dos cenários 1–10 do **próprio** harness (`test-idempotencia.mjs`) contra `sandbox.asaas.com`; (3) resolução do `customer` — **concluída** (fluxo "cliente por usuário", exercitado no Sandbox); (4) taxa do saque instantâneo. **Não confundir com a Etapa 2:** o harness `sandbox-etapa2.mjs` ter rodado no Sandbox (Sessões 11–12) **não** aprova a Etapa 1 — são conjuntos de teste distintos. A Etapa 1 **não** está aprovada só porque a Etapa 2 foi exercitada.
   - **Re-auditoria dos critérios (Sessão 16, 2026-10-19).** Evidência fresca: bateria `.tools\test-idempotencia.ps1` → **exit 0, 92 OK / 0 FALHA** (log `%TEMP%\opencode\etapa1-reaudit.log`); sonda somente-leitura de invariantes limpa (`ChargeAttempt=62` todas `CONFIRMED`, **zero** duplicata de `(entity,entityId,attempt)`, **zero** `providerPaymentId` em 2 `CONFIRMED`, todo alvo = última tentativa; ledger `RETENCAO 15/REEMBOLSO 4/LIBERACAO 6` inalterado); `tsc --noEmit` exit 0 — **nenhum FAIL**. **Recomendação: `PENDENTE`** (lacuna de *definição* de critério, não de código). O critério (2) atual é parcialmente **infactível** (cenários 1/7/10 e partes de 2/8 dependem de *fault injection*, impossível no provedor real); o critério (4) exige operação financeira real (não autorizada); o critério (3) está **atendido**.
   - **Proposta de definição formal dos critérios de fechamento da Etapa 1 (para aprovação humana — NÃO aplicar antes do aceite):** (a) **revisão humana** do diff de idempotência (obrigatória); (b) **mock obrigatório**: cenários 1–12 do `test-idempotencia.mjs` 100% verdes (os cenários de falha induzida não são reproduzíveis no provedor real); (c) **Sandbox real, apenas cenários factíveis e não destrutivos** (criação, reuso/repetição, concorrência, exclusão→nova tentativa, cliente 1×), registrando ids; (d) **contrato real observado** de `hasMore`/fantasma (no lugar do cenário 10 truncado, que não se induz); (e) **transferência Pix de baixo valor** classificada como critério de **produção**, separado do fechamento da idempotência. Sob esta definição, (a)+(b)+(d) já atendidos e (c) parcialmente atendido pela Etapa 2 → `APROVADA COM RESSALVAS` após aceite humano; `APROVADA` plena exigiria (c) reexecutado pelo harness da Etapa 1 contra o Sandbox.
   - **FECHAMENTO APROVADO (2026-10-19).** O responsável aprovou a definição acima; a **revisão humana do diff foi concluída sem bloqueador crítico** (Sessão 17). Etapa 1 registrada como **`APROVADA COM RESSALVAS — critérios de fechamento aprovados; transferência Pix permanece como gate independente de produção.`** Nenhuma operação financeira executada; nenhuma fase seguinte iniciada.
- [x] **Decisão sobre `customer` no `POST /payments` — RESOLVIDA ("cliente por usuário"), implementada e validada localmente:** decisão autorizada pelo responsável (2026-10-18). Na 1ª cobrança de cada usuário cria o cliente no provedor (`POST /customers`) com dados que o usuário **já** cadastrou (nome/razão social, e-mail, CPF/CNPJ em dígitos, telefone — sem PII nova), persiste o id em `User.asaasCustomerId` (migração **aditiva** `20261018150000_etapa2_customer_usuario`) e reutiliza sempre; trava advisory por usuário impede cliente duplicado. Recusa definitiva (4xx) → 502; rede/5xx → 503, nada cobrado. O mock passou a **reproduzir o contrato real** (`POST /v3/customers` e `customer` obrigatório em `POST /v3/payments` → 400 `invalid_customer`) e o cenário 11 do harness prova "criado 1× e reutilizado". **Exercitado no Sandbox real (Etapa 2, 2026-10-19):** cliente `cus_000009561631` criado 1× e reutilizado em cobranças reais (exec4 e modo `--keep-charges`) — ver `sandbox-exec4.log`. A transição financeira real (`CONFIRMED/RECEIVED → RETIDO`, chat, ledger, idempotência pós-confirmação) **segue pendente** (ver item da Etapa 2 abaixo).
- [x] **Etapa 2 (automação) validada no Sandbox do Asaas — transição financeira então PENDENTE (comprovada depois; ver 2026-10-19 abaixo).** `sandbox-etapa2.mjs` → `SANDBOX_EXIT=0`, 37 OK/0 FALHA (exec4, 2026-10-19). Identificadores sem segredos: `runId=6611160`, contratações `cmvemrcbb0003fnf8a7xgn7wa` e `cmvemrimr0007fnf8e4ymcqyk` — ver `sandbox-exec4.log`. Pagamentos (exec4): `pay_z6qoyad1heidrjd1` (1ª cobrança do hiring A), `pay_djewxnmap7wo669x` (nova cobrança do MESMO hiring `cmvemrcbb0003fnf8a7xgn7wa` após exclusão), `pay_n1wbx0jcb3h0d7dn` (hiring `cmvemrimr0007fnf8e4ymcqyk`, cenário concorrência), `pay_dtdmqdgut2zb23to` (boost `cmvemrk6g000t3ixiz6pz5x4r`). Cliente: `cus_000009561631` (criado 1× e reutilizado). Cenários 0–8 aprovados: credencial `$aact_hmlg_` autenticada, `customer` obrigatório respeitado ("cliente por usuário"), QR Pix válido, repetição reutiliza cobrança (hasMore=false), semântica fantasma do DELETE tratada (listagem como autoridade), webhook aceito com corpo real e reenvio idempotente (sem alteração de estado enquanto `PENDING`).
   - **BLOQUEIO 2026-10-19 (verificado por sonda somente-leitura):** todos os 4 pagamentos de teste foram **excluídos na limpeza do cenário 8** (`deleted=true`, mas GET-by-id devolve `PENDING` — fantasma). Como não existem mais como cobrança ativa, **não é possível confirmá-los no console do Sandbox**. Associação verificada: `pay_djewxnmap7wo669x` → `cmvemrcbb0003fnf8a7xgn7wa` (não o hiring antes suposto). Estado no banco: ambas as contratações seguem `AGUARDANDO_PAGAMENTO`, **0 lançamentos** no ledger, **sem chat**. Para provar `CONFIRMED → RETIDO → chat ABERTO → RETENCAO`, é preciso **criar uma nova cobrança real e mantê-la viva** (sem limpeza) para confirmação manual no console.
   - **DESBLOQUEIO PARCIAL 2026-10-19:** o harness ganhou `--keep-charges` (mantém as cobranças PENDING vivas) e `--verify <hiringId>` (comprova a transição, sem criar nada). Execução `--keep-charges` → exit **0, 37 OK/0 FALHA**, com 3 cobranças vivas (`deleted=false`): `pay_u8c161bwlhoox6bn` (ref `cmveqi5n80003t5drjb1f4gyu`), `pay_77rpr1rlzm2t717v` (ref `cmveqicd10007t5dr1w3vmvp6`) e `pay_emsiz6eibte8ysgc` (boost `cmveqiedg000tfenkjm6nnqsb`). `tsc --noEmit` exit 0; `next build` exit 0 (o primeiro build falhou por EPERM em `.next` com o dev server no ar — infraestrutura).
   - **VALIDADO 2026-10-19 (transição financeira real COMPROVADA — 2 contratações):** confirmado `pay_u8c161bwlhoox6bn` (hiring `cmveqi5n80003t5drjb1f4gyu`) no console do Sandbox; `node .tools\sandbox-etapa2.mjs --verify cmveqi5n80003t5drjb1f4gyu` → **exit 0, 12 OK/0 FALHA** (`%TEMP%\opencode\sandbox-verify.log`): pagamento `CONFIRMED` (V2), contratação **`RETIDO`** (V4), chat **`ABERTO`** (V5), exatamente **1 `RETENCAO` = bruto `80000`** (V6/V7), reentrega e evento tardio **não** duplicam (V10/V13), estado permanece `RETIDO` (V11). Antes→depois: `AGUARDANDO_PAGAMENTO → RETIDO`; global `RETENCAO 13 → 14` (**+1 exato**); `REEMBOLSO`/`LIBERACAO` e `ChargeAttempt` inalterados. **2ª contratação (Fase B, 2026-10-19):** `--verify cmveqicd10007t5dr1w3vmvp6` → exit **0, 12 OK/0 FALHA** (`sandbox-verify-faseB.log`): `RECEIVED → RETIDO` + chat `ABERTO` (`cmvflor230002bl9rkcfok26r`) + 1 `RETENCAO=80000` + idempotência; global `RETENCAO 14 → 15`. **Etapa 2 (financeiro) comprovada no Sandbox para 2 contratações.**
   - **Pendências manuais:** reembolso/estorno pós-confirmação; transferência Pix (só se o Sandbox realizar). **Observação:** `pay_77rpr1rlzm2t717v` (hiring `cmveqicd10007t5dr1w3vmvp6`) foi processado e validado (ver acima). **Boost VALIDADO (Sessão 15, 2026-10-19):** `pay_emsiz6eibte8ysgc` (`cmveqiedg000tfenkjm6nnqsb`) foi processado via novo modo `--verify-boost` → exit **0, 20 OK/0 FALHA**: `JobBoost PENDENTE → PAGO`, `providerPaymentId` correto, `jobPosting.urgentBoost=false → true`, **zero** `LedgerEntry`, sem chat/contratação, idempotência em reentrega + evento tardio. A lacuna do verificador de boost está **fechada**.
    - **REVISÃO FORMAL DA ETAPA 2 CONCLUÍDA (Sessão 18, 2026-10-19) — recomendação `APROVADA COM RESSALVAS` (aguardando aceite humano).** Matriz de cenários montada só com evidências existentes (Sandbox real + local/DB + mock): **PASS** em criação, `customer` 1×/reuso, QR Pix, repetição/reuso, concorrência, exclusão+nova tentativa (fantasma), webhook `PENDING`→não aprovado, webhook aprovado→`RETIDO`+chat+1 `RETENCAO` (2 contratações), boost `RECEIVED→PAGO`+`urgentBoost`+zero ledger, reentrega/evento tardio idempotentes, autenticidade por token (fase4: 401/400/404), preservação do ledger. Sonda fresca somente-leitura: ambas as contratações `RETIDO` com 1 `RETENCAO`=80000 e chat `ABERTO`; boost `PAGO`+`urgentBoost=true`; ledger `15/4/6`; zero `RETENCAO` duplicada; `tsc` exit 0. **NOT RUN/BLOCKED (gates de produção, não bloqueiam a Etapa 2):** reembolso/estorno pós-confirmação (`PAYMENT_REFUNDED`), **chargeback** (sem ramo explícito — não reverte retenção) e **transferência Pix** de saída; mais a **paginação multipágina** (>100). **Não reclassificar sem aceite humano.**
- [x] **Etapa 3 (pós-auditoria): webhook/chargeback Asaas — IMPLEMENTADA E TESTADA (mock); validação Sandbox PENDENTE.** Implementado: autenticação por cabeçalho `asaas-access-token` (com fallback `body.token` só em teste), persistência durável antes do ACK (modelo `AsaasEvent`), idempotência por `event.id`, ramos dos 3 eventos de chargeback (`ChargebackEvent`), **bloqueio transacional de repasse** (`FOR UPDATE`; guarda no commit prevalece), disputa endurecida (`openDispute`/`resolveDispute` com lock + releitura), rotas admin (`GET /api/admin/chargebacks`, `POST /api/admin/payouts/[id]/release-manual`). Migração **aditiva** `20261020120000_etapa3_asaas_eventos_chargeback`. Testes **versionados**: `.tools/test-chargeback.mjs` + `.tools/test-chargeback.ps1` (9 seções) integrados ao `.tools/run-all-tests.ps1` (passo **9/9**). **Ressalvas:** validação no Sandbox **não** executada (chargeback real não observado); decisões humanas **D1–D8** pendentes (só proteções independentes implementadas). **Não autoriza produção.**
  - **Etapa 3.1 (Sessão 20, 2026-10-20) — git inicializado + P1–P5 RESOLVIDOS por doc oficial.** Repositório git criado (commit `fa4066d`; `.env` **não** versionado — `git check-ignore` confirma). **P1** cabeçalho `asaas-access-token`, por webhook, **sem HMAC**; **P2** `chargeback` vive **dentro de `payment`** (webhook enxuto; objeto completo no GET) — parser **corrigido** para `payment.chargeback`; **P3** `AWAITING_CHARGEBACK_REVERSAL` = "Disputa vencida, aguardando repasse" (venceu a plataforma); **P4** backoff 0→3h e fila pausada após **15** falhas; **P5** URL oficial `https://api-sandbox.asaas.com/v3` (`.env` usa o legado; **não alterado** — decisão do usuário). Divergências de código corrigidas: leitura de `payment.chargeback` + campos reais `disputeStartDate`/`deadlineToSendDisputeDocuments`/`disputeStatus` (migração **aditiva** `20261020150000_etapa31_chargeback_campos_doc`). Fixture versionado `.tools/fixtures/asaas-chargeback.json` (`_source`/`_captured_at`); script `.tools/sandbox-chargeback-real.mjs` (somente leitura; **PENDENTE/exit 3** sem chargeback observado — a doc exige solicitação por e-mail ao Asaas). **Nenhuma política D1–D8 foi decidida.**
- [ ] Etapa 3: documentar variáveis por ambiente, backup/restauração/migrações, agendamento e proteção de crons; `INSTANT_WITHDRAWAL_FEE_BPS` segue **desabilitada em produção** até decisão formal sobre o 1%

## Fase 6 — Polimento
- [ ] Notificação por WhatsApp
- [ ] Modo escuro
- [ ] Estados de carregamento (skeleton)
- [ ] OAuth Instagram/Facebook/TikTok (perfil de influenciador)
- [x] Testes automatizados cobrando os fluxos críticos (seleção, pagamento/webhook real do Asaas, cancelamento, códigos, disputas, denúncias, avaliação, concorrência, painel admin — bateria nas Fases 1 a 5; o total corrente está em `progress.md`)
- [ ] Deploy em produção + monitoramento de erro

---

**Próximo passo recomendado agora:** a **Etapa 1 da pós-auditoria** (idempotência de cobrança) e
a decisão **"cliente por usuário"** do campo `customer` estão implementadas e **validadas
localmente** (bateria 681/681 + 3 repetições 84/84 + conferência de banco 9/9, exits 0 — ver
`progress.md` > Sessão 11); a próxima ação é a **Etapa 2 — Sandbox do Asaas**: você coloca a chave
Sandbox em `ASAAS_API_KEY` no `.env` e avisa; então `node .tools\sandbox-etapa2.mjs` valida os
cenários preparados contra `sandbox.asaas.com` (confirmação no console, reembolso e transferência
seguem como passos manuais registrados). No restante, continuar a
Fase 5 (administração e monetização avançada). O painel operacional está pronto em `/admin`
(disputas, denúncias, identidade, consultas, reconciliação ao vivo e lote de repasses) e coberto
por `.tools/run-all-tests.ps1` (totais em `progress.md`). Faltam: persistência do relatório de
reconciliação, painel de métricas e as configurações financeiras editáveis. O loop do
marketplace (Fase 2), o caminho do dinheiro (Fase 3, agora sobre o Asaas) e a camada de
confiança (Fase 4: avaliação mútua, confiabilidade, check-in, disputas e denúncias) estão
implementados e cobertos pela bateria. Antes de ir a produção, habilitar o Asaas real:
`ASAAS_API_URL=https://api.asaas.com/v3`, chave de produção e UMA transferência Pix de baixo
valor testada antes do primeiro lote semanal (ver `findings.md`).
