# progress.md — Freelaz

Log do que foi feito, na ordem em que aconteceu. Atualize ao final de cada sessão de trabalho — isso é o que permite a um agente novo (ou você mesmo, dias depois) entender o histórico sem reler a conversa inteira.

---

## Sessão 1 — Modelagem e integração Mercado Pago

**Feito:**
- `prisma/schema.prisma` criado com: identidade (User, papéis, perfis), vagas/candidaturas (JobPosting, Application, lista de suplentes), financeiro (Payment, LedgerEntry, Payout, PixKey), plano CLT, contas sociais (influenciador)
- `src/lib/mercadopago.ts`, `src/lib/prisma.ts`, `src/lib/idempotency.ts` — infraestrutura de baixo nível
- `src/services/ledgerService.ts` — registro de retenção/liberação/reembolso
- `src/services/payoutService.ts` — repasse Pix (com a ressalva documentada em `findings.md`)
- `src/app/api/payments/create/route.ts` e `src/app/api/webhooks/mercadopago/route.ts` — cobrança e recebimento de notificação

**Erros encontrados e resolvidos:**
- Tentei validar o schema com `npx prisma validate` e descobri que a versão mais recente do Prisma CLI não tem mais esse comando (mudou de paradigma). Resolvido fixando a versão `5.17.0` no `package.json`, que usa os comandos clássicos.

## Sessão 2 — Cadastro único, lista de suplentes, "Me contrate" com contraproposta

**Feito:**
- Reestruturado o cadastro: de "3 tipos de conta" fixos para cadastro único (CPF/CNPJ) com papéis ativáveis (Profissional/Contratante)
- Adicionado `JobPosting` e `Application` ao schema (antes só existia `Hiring` direto, sem conceito de vaga pública/candidatura)
- Adicionado `JobBoost` para o impulsionamento pago "Publicar com urgência" (R$10)
- Unificado "desistência" e "desfazer match" num único caminho de cancelamento (`matchService.ts` reescrito)
- Adicionado filtro automático de conflito de agenda na lista de suplentes (`listSubstitutes`)
- "Me contrate" implementado como `JobPosting` com `visibility: PRIVADA` + `Application` com campos de contraproposta (`counterOfferValueCents`, `counterOfferBy`, `agreedValueCents`)
- Rotas novas: `/api/jobs/boost`, `/api/jobs/[id]/select`, `/api/jobs/[id]/resume`, `/api/jobs/invite`, `/api/applications/[id]/counter-offer`, `/api/applications/[id]/respond`
- `codeService.ts` — geração dos códigos de abertura (1h antes do início) e fechamento (1h antes do fim), e liberação da avaliação (2h após o uso do código de fechamento)

**Testes feitos:** nenhum ainda rodado contra banco real — revisão foi só leitura manual do schema (linha a linha), sem Prisma CLI funcional disponível no ambiente usado para gerar o código.

## Sessão 3 — Protocolo de execução (package.json, README, V.L.A.E.G.)

**Feito:**
- `package.json` com versões fixas, `.env.example`, `tsconfig.json`, `next.config.js`, `.gitignore`
- `src/app/layout.tsx` e `page.tsx` — página mínima para confirmar visualmente que o servidor sobe
- `README.md` com passo a passo gratuito completo (Neon, Mercado Pago sandbox, ngrok, Thunder Client, Prisma Studio)
- `VLAEG.md` e esta pasta `.protocol/` (task_plan.md, findings.md, progress.md)

---

## Sessão 4 — Fase 1: autenticação, papéis, perfil e verificação

**Feito:**
- `src/lib/document.ts` — validação de CPF e CNPJ (inclui o CNPJ alfanumérico novo) + bloqueio de menor de 18 anos
- `src/lib/auth.ts` — senha com **scrypt nativo do Node** (sem dependência nova), sessão por token opaco com **hash** no banco (`Session`), tokens de uso único (`AuthToken`) para confirmação de e-mail e reset de senha
- Rotas: `/api/auth/register` (cadastro único CPF/CNPJ + papéis + aceite dos Termos com data/hora), `/login`, `/logout`, `/me`, `/roles`, `/confirm`, `/password/forgot`, `/password/reset`
- Perfil: `GET/PUT /api/profile/professional` (bio, categorias livres, disponibilidade, soft skills, preço de referência, experiências MM-AAAA, portfólio, currículo) e `GET/PUT /api/profile/contractor`
- Verificação: `POST /api/verification/professional` (documento + selfie para CPF; envio de CNPJ para análise) e `POST /api/verification/contractor` (verificação leve, exige e-mail confirmado)
- `src/lib/uploads.ts` + `GET /api/uploads/[...path]` — arquivos em disco (`uploads/`, fora do Git); documento/selfie/currículo só acessíveis pelo dono
- **Retrofit de segurança nas rotas que já existiam** (escritas antes da Fase 1, todas abertas): agora exigem sessão e checam dono/papel — `payments/create`, `jobs/[id]/select`, `jobs/[id]/resume`, `jobs/boost`, `jobs/invite` (contratante vem da sessão, não do corpo), `applications/[id]/counter-offer` e `/respond` (o lado que negocia é deduzido da sessão), `payouts/release` (passou a exigir header `x-internal-secret` em produção)
- Schema: `User.termsAcceptedAt/emailConfirmedAt/phoneConfirmedAt`, `Session`, `AuthToken`, `IdentityVerification`, `PortfolioItem`, `WorkExperience`, `UserRoleAssignment.status`, campos novos do `ProfessionalProfile`
- `.env.example` ganhou `MERCADOPAGO_WEBHOOK_SECRET` (faltava — sem ele o webhook recusava tudo) e `INTERNAL_API_SECRET`

**Decisões tomadas nesta sessão (registradas em `findings.md`):**
- Papel Profissional nasce `PENDENTE` e só ativa com verificação aprovada; Contratante nasce `ATIVO` (selo de verificado exige confirmação de e-mail)
- Aprovação de verificação é manual (Prisma Studio) até o painel admin da Fase 5
- Sem dependência nova de auth (scrypt + sessão em banco em vez de bcrypt/JWT)

**Ainda não testado contra banco real** — nenhuma máquina de dev tinha Node/Postgres; instalação iniciada nesta sessão.

## Sessão 5 — Ambiente de dev local e validação ponta a ponta da Fase 1

**Feito:**
- Provisionado o toolchain sem instalação online: Node 20.20.2 portátil em `.tools/node-v20.20.2-win-x64` e PostgreSQL 16.14 portátil em `.tools/pg/package/native/bin`, cluster em `.tools/pgdata` (user/senha `postgres`, porta 5432), banco `freelaz`
- `npm install` concluído; `npx tsc --noEmit` limpo (typeScript strict)
- Migração aplicada: `20261016195606_init`
- `.tools/run-fase1-tests.ps1` criado: reseta o banco, roda as 3 partes em sequência e extrai o token de confirmação de e-mail do log do dev server
- **Bateria da Fase 1 passando: 15 + 8 + 12 = 35/35**

**Bug encontrado e corrigido no teste (não no código):** `test-fase1c.ps1` — a etapa D logava a Maria
sem trocar de cookie jar, sobrescrevendo a sessão do João dentro de `jarJoao`. Resultado: a etapa G
(charme de contraproposta do João) executava como Maria e recebia 403, e o J aceitava 25000 em vez dos
30000 acordados. Isso mascarava o comportamento real — a rota de contraproposta estava certa.

**Resultado dos testes (registro):**
- Parte 1: 15/15 (cadastro, 409/422, força de perfil 65, verificação EM_ANALISE, upload privado 401)
- Parte 2: 8/8 (confirmação de e-mail, verificação de contratante, reset de senha, token de uso único)
- Parte 3: 12/12 (papel ATIVO, retrofit 401/403, contraproposta 30000 CONTRAPROPOSTA/PROFESSIONAL, dono do boost)

## Sessão 6 — Fase 2: loop do marketplace validado ponta a ponta

**Feito:**
- Migração `20261016200839_fase2_chat` aplicada: enum `ChatStatus`, modelos `Chat` e `Message`, relações `Hiring.chat` e `User.messages`
- `src/lib/jobInput.ts` (validação compartilhada de vaga), `src/lib/jobPublic.ts` (projeção pública da vaga), `src/lib/commission.ts` (comissão de 10% fixo + valor do boost), `src/lib/hiringAccess.ts` (participante da contratação) e `src/lib/db.ts` (handle client/transação)
- Rotas do marketplace: `GET/POST /api/jobs`, `GET/PATCH/DELETE /api/jobs/[id]`, `POST /api/jobs/[id]/apply`, `GET /api/jobs/[id]/applications`, `GET /api/applications`
- Rotas de contratação/chat: `GET /api/hirings`, `GET /api/hirings/[id]`, `GET /api/hirings/[id]/chat`, `POST /api/hirings/[id]/chat/messages`
- **`selectCandidate` agora cria o `Hiring`** numa transação, idempotente por `applicationId` e bloqueando uma segunda contratação viva por vaga — resolve a lacuna crítica em que `/api/payments/create` cobrava um Hiring que ninguém criava
- `ledgerService` passou a aceitar handle de transação; `webhook`, `matchService`, `codeService` e `payoutService` agora mudam status **só** via `hiringService.setHiringStatus` (regra do VLAEG: nunca escrita livre de status)
- Chat **derivado** do status da contratação (`chatService.ts`): `AGUARDANDO_PAGAMENTO` enquanto não pago, `ABERTO` em `RETIDO/EM_ANDAMENTO/CONCLUIDO/EM_DISPUTA`, `ENCERRADO` em `CANCELADO/LIBERADO`
- `.tools/test-fase2.ps1` criado (autossuficiente) + `.tools/fase2-service-sim.js`, que compila o serviço real (`hiringService.setHiringStatus`) para CommonJS via `tsc` e o executa contra o banco — necessário porque o webhook do Mercado Pago exige assinatura HMAC + credencial real (impossível sem sandbox)
- `.tools/run-all-tests.ps1` criado (substitui `run-fase1-tests.ps1`): reseta o banco uma vez e roda Fase 1 (1a/1b/1c) + Fase 2, parando na primeira etapa que falhar (todo script devolve exit code)
- `npx tsc --noEmit` limpo após as mudanças

**Resultado dos testes (registro):**
- Fase 1: 15 + 8 + 12 = **35/35** (continua passando após a refatoração do `selectCandidate`)
- Fase 2: **112/112** — publicação de vaga, busca/filtros, edição/cancelamento, candidaturas (401/403/409/201), seleção → Hiring (bruto 20000 / líquido 18000 / comissão 2000), `GET /api/hirings` dos dois lados, chat bloqueado antes do pagamento e ABERTO após `RETIDO`, contraproposta 25000 → líquido 22500, suplentes com conflito de agenda e chat ENCERRADO no `CANCELADO`
- Total do projeto: **147/147**

**Contas criadas pelos testes (descartáveis):** Fase 2 cadastra `empresa@exemplo.com` (CNPJ 12.345.678/0001-95), `ana@exemplo.com` (CPF 123.456.789-09) e `bruno@exemplo.com` (CPF 111.444.777-35), todas com senha `senhaSegura123`. São autossuficientes — não dependem das contas da Fase 1.

## Sessão 7 — Fase 3: dinheiro validado ponta a ponta

**Feito:**
- `src/lib/pixProvider.ts` — interface `PixTransferProvider` com três implementações: placeholder que RECUSA (produção, até a API do MP ser confirmada), sandbox (`PAYOUT_SANDBOX=1`, só fora de produção) e a fábrica `getPixTransferProvider()`. Assim um `.env` mal configurado não consegue liberar dinheiro de brincadeira em produção.
- `src/lib/fees.ts` — taxa do saque instantâneo lida de `INSTANT_WITHDRAWAL_FEE_BPS` (pontos-base em inteiro; padrão 100 = 1%, PLACEHOLDER) + `instantWithdrawalFeeCents`, que arredonda para baixo (o profissional nunca é cobrado um centavo a mais por arredondamento).
- `src/lib/internalAuth.ts` — `checkInternalSecret` compartilhado pelas rotas internas (`/api/cron/*`, `/api/payouts/release`): em produção exige o segredo; em dev cobra se `INTERNAL_API_SECRET` estiver definido (assim o teste exercita a trava) e só abre com aviso se não houver segredo nenhum.
- `walletService.ts` — carteira **calculada**, nunca guardada: `aReceberCents` (RETIDO/EM_ANDAMENTO/EM_DISPUTA → líquido), `disponivelCents` (CONCLUIDO sem payout ou payout FALHOU), `emProcessamentoCents` (payout PENDENTE/PROCESSANDO), `sacadoCents` (payout CONCLUIDO), além do extrato com CREDITO e TRANSFERENCIA (com taxa e status).
- `payoutService.ts` reescrito: `releasePayout` idempotente (no máximo um Payout por contratação), retenta payout `FALHOU`, valida chave Pix e taxa, e grava Payout + `recordRelease` + `setHiringStatus(LIBERADO)` na MESMA transação; `processPendingPayouts` para o lote semanal; `releasePayoutManually` agora também cria o Payout CONCLUIDO (sem isso carteira e reconciliação não enxergariam a saída).
- `reconciliationService.ts` — 5 invariantes (sem saldo negativo; LIBERADO tem Payout CONCLUIDO; Payout CONCLUIDO tem LIBERACAO de igual valor; pagamento confirmado tem RETENCAO igual ao bruto; Payout CONCLUIDO implica LIBERADO). Relatório **stateless**: logado, não persistido (persistência é Fase 5).
- `codeService.ts` ganhou `markOpeningCodeUsed` — o gatilho real de `RETIDO → EM_ANDAMENTO` (fecha a lacuna conhecida da Fase 2).
- `ledgerService.ts` extraído `computeRetainedBalance`: a mesma regra de saldo serve ao saldo por contratação, ao total da plataforma e à reconciliação (se divergissem, a reconciliação acusaria diferença inexistente).
- Rotas novas: `POST /api/hirings/[id]/codes`, `GET /api/wallet`, `POST /api/wallet/withdraw`, `POST /api/cron/shift-codes`, `POST /api/cron/payouts`, `POST /api/cron/reconciliation`.
- `GET/PUT /api/profile/professional` passaram a ler/gravar `pixKey` (destino do repasse, vive no `User`, máx. 120 caracteres).
- `.env`/`.env.example` ganharam `PAYOUT_SANDBOX` e `INSTANT_WITHDRAWAL_FEE_BPS`.
- `.tools/fase3-sim.js` + `.tools/test-fase3.ps1` (103 assertions) e `run-all-tests.ps1` agora com o passo 5/5.

**Modelo de dinheiro (decisão fechada):** a liberação **é** a transferência Pix — não existe tabela de "saldo disponível" intermediário. A carteira é sempre calculada a partir das contratações e dos Payouts; saldo nunca é um número armazenado. Por isso **não houve migração de schema nova nesta fase** (a taxa é derivável como `netValueCents − payout.amountCents`).

**Resultado dos testes (registro):**
- Fase 1: 15 + 8 + 12 = 35/35
- Fase 2: 112/112
- Fase 3: **103/103** — carteira (401/403/estado vazio/taxa 100 bps), vaga na janela do agendador → seleção → `RETIDO` com retenção e `mpPaymentId`, códigos (geração por cron, código errado 422, profissional 403, `RETIDO → EM_ANDAMENTO → CONCLUIDO`), saque com taxa 180 (1% de 18000) → `LIBERADO`, extrato, lote semanal (13500 sem taxa + segundo lote idempotente), reconciliação `ok=true`, trava de segredo interno (403/400/422)
- Total do projeto: **250/250**
- `npm run build` de produção: **limpo** (todas as rotas compiladas, sem erro)

**Contas criadas pelos testes (descartáveis):** Fase 3 cadastra `empresa3@exemplo.com` (CNPJ 33.333.333/0001-91), `ana3@exemplo.com` e `bruno3@exemplo.com`, todas com senha `senhaSegura123`. Os CPFs são gerados em tempo de execução pelo módulo 11 (com auto-checagem do auxiliar contra o CPF conhecido `123.456.789-09`), para nunca colidir com os das fases anteriores.

**Decisões tomadas nesta sessão (registradas em `findings.md`):**
- Repasse é a transferência Pix e não há saldo intermediário guardado — carteira sempre calculada.
- Taxa do saque instantâneo é PLACEHOLDER de 1% e precisa de confirmação do produto.
- Provedor Pix plugável com sandbox **só** fora de produção; produção sempre cai no placeholder que recusa.
- Reconciliação reporta, mas não corrige: ajuste manual é lançamento `AJUSTE` no ledger, com revisão humana.

## Sessão 8 — Fase 4 (confiança) + migração dos pagamentos ao Asaas

**Decisão humana:** migrar os pagamentos do Mercado Pago para o **Asaas** (motivo: transferência Pix para terceiros é API autoatendível em conta padrão — a pendência que travava a Fase 3). Migração feita preservando dados (RKEEP) e sem reescrever o que já funcionava.

**Feito (Asaas):**
- `src/lib/asaas.ts` — cliente da API (`POST /payments` com cabeçalho `idempotencyKey`, `GET /payments/{id}/pixQrCode`, `POST /transfers`) + `isValidAsaasWebhookToken` (token do corpo comparado em tempo constante — o Asaas não assina HMAC, o que **remove** a trava que impedia testar webhook sem sandbox real)
- `src/lib/pixProvider.ts` — provedor real agora chama `/transfers` do Asaas (Pix de saída); sandbox e placeholder inalterados (produção sempre cai no placeholder sem chave)
- Webhook `/api/webhooks/asaas` (o de mercadopago foi removido): token → rebusca do pagamento na API quando há credencial (502 na falha) → `PAYMENT_CONFIRMED/RECEIVED` = `PREENCHIDA` + `RETIDO` + `recordRetention` na MESMA transação, com trava `SELECT ... FOR UPDATE` + re-cheque de status (webhook duplicado/simultâneo não retém duas vezes — testado); `PAYMENT_DELETED` = `CANCELADO`; `PAYMENT_REFUNDED` = estorno via ledger
- `POST /api/payments/create` e `POST /api/jobs/boost` idempotentes e **503 sem `ASAAS_API_KEY`** (sem "sucesso simulado")
- Renomes RKEEP: `Hiring.providerPaymentId`, `Payout.providerTransferId`, `JobBoost.providerPaymentId`; `mpPreferenceId` removido; dependência `mercadopago` fora do `package.json`; `.env`/`.env.example` com `ASAAS_API_URL`/`ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN`

**Feito (Fase 4 — confiança):**
- Migração `20261016214500_fase4_confianca_asaas`: `Evaluation`, `CheckIn`, `Dispute`, `DisputeEvidence`, `Report`, `CodeAttempt`, `Hiring.disputeOpen`/`closingCodeUsedAt`, `ProfessionalProfile.reliabilityScore` + índices únicos parciais (`Hiring_uma_contratacao_viva_por_vaga`, `LedgerEntry_uma_retencao_por_contratacao`, `Dispute_uma_disputa_aberta_por_contratacao`)
- `evaluationService.ts` — avaliação mútua (1-5 + comentário, uma por parte por contratação), liberada só 2h após o código de fechamento; média atualizada nos dois perfis
- `reliabilityService.ts` — % de conclusões limpas nas últimas 20 contratações terminais, recalculada a cada transição terminal, guardada em `reliabilityScore`
- `checkInService.ts` — evidência de geolocalização do profissional (idempotente, não bloqueia o código de abertura)
- `disputeService.ts` — disputa (uma aberta por contratação, `EM_ANALISE`), evidências (data URL, só enquanto em análise) e decisão admin: `DEVOLUCAO_TOTAL` (estorno total, `CANCELADO`), `LIBERACAO_TOTAL` (repasse integral) ou `DIVISAO` (percentual do líquido ao profissional, comissão fica; exige chave Pix)
- `reportService.ts` — denúncias com fila separada (`ABUSO` nasce `ALTA`), decisão auditada (`ACAO_TOMADA`/`ARQUIVADA`), nunca move dinheiro
- Gate de liberação: janela de 2h após o código de fechamento + sem disputa aberta (saque instantâneo e lote semanal)
- Limite de 5 tentativas de código por (contratação, tipo) com auditoria `CodeAttempt`
- Rotas: `evaluations`, `reports`, `hirings/[id]/{cancel,check-in,dispute,dispute/evidence,codes}`, `admin/{disputes,disputes/[id]/resolve,reports,reports/[id]/resolve}` (header `x-internal-secret` + `adminId` auditado); `GET /api/hirings/[id]` agora inclui `evaluations`/`checkIn`/`disputes`
- Cancelamento unificado: reembolso de 100% via ledger (sem multa até o produto definir), estados terminais nunca reabrem (409)
- `.tools/test-fase4.ps1` (202 assertions, autossuficiente) + `run-all-tests.ps1` com 6 passos; `.tools/fase2-service-sim.js` passou a espelhar o webhook completo (status + ledger na mesma transação)

**Correções de teste feitas durante a validação (código permaneceu íntegro):**
- `test-fase1c.ps1`: boost sem credencial agora espera **503** (Asaas) e não mais 500 (Mercado Pago)
- Here-strings expandáveis: `prisma.$disconnect()` virava `prisma.();` (`$disconnect` expandida como variável) — escapado como `` `$disconnect `` nos 5 blocos `@"` (os `@'` literais não precisam)
- `test-fase4.ps1` (3 raízes das 19 falhas da primeira rodada, todas no teste): jar de sessão não restaurado após `Send-Webhook` (401 em cascata); cancelamento de W1 na seção errada (W1 `RETIDO` é cancelável → quebrava a disputa da seção seguinte — movido para depois da resolução, quando o estado terminal deve devolver 409); seleção concorrente devolve 422 e não 409 (a rota captura o erro do serviço)
- **Encoding:** `.ps1` UTF-8 sem BOM é lido como ANSI pelo PowerShell 5.1 e não-ASCII quebra o parser (97 erros em cascata); normalizado para UTF-8 **com BOM** + CRLF e validado com `[Parser]::ParseFile` — lição registrada em `findings.md`

**Resultado dos testes (registro):**
- Fase 1: 15 + 8 + 12 = 35/35 (com a asserção de boost atualizada para 503)
- Fase 2: 112/112 (sim do webhook agora inclui a retenção no ledger — a invariante `pagamento_confirmado_retido` da reconciliação pegou a lacuna do sim antigo)
- Fase 3: 103/103 (reconciliação `ok=true` com os hirings da Fase 2 enxergados pela invariante corrigida)
- Fase 4: **202/202** — webhook real (token 401/valor 400/desconhecido 404/válido 200/duplicado idempotente/2 simultâneos com 1 retenção), check-in (criação/idempotência/400/403), limite de 5 tentativas com auditoria, cancelamento 100% (403 estrangeiro/200/409 terminal/vaga reaberta), disputa antes/durante/depois com os 3 desfechos (devolução → `CANCELADO` sem repasse; divisão 50% → payout 4500; liberação → payout 14400), gate de 2h, avaliação mútua + médias, confiabilidade 33.3 → 60.0, denúncias (`ABUSO` primeiro, decisão auditada), 503 nas rotas de cobrança sem credencial, seleção dupla concorrente (1×200 + 1×422)
- Total do projeto: **452/452**

**Contas criadas pelos testes (descartáveis):** Fase 4 cadastra `empresa4@exemplo.com`, `ana4@exemplo.com` e `bruno4@exemplo.com`, senha `senhaSegura123`, CPFs/CNPJ gerados por módulo 11 em tempo de execução (nunca colidem com as fases anteriores).

**Pendências herdadas/novas:** produção do Asaas (chave real + teste de transferência de baixo valor antes do lote semanal); taxa do saque instantâneo (1% placeholder); aprovação de verificação manual (Fase 5); agendador real para as rotas `/api/cron/*` (Fase 5/infra); notificação do código de abertura ao profissional (push/WhatsApp é Fase 6).

## Sessão 9 — Fase 5: painel administrativo mínimo

**Objetivo:** operar, por uma UI web mínima em `/admin`, as funções que já existiam —
análise de disputas/denúncias, aprovação manual de identidade, consultas financeiras,
reconciliação e o disparo do lote de repasses. **Sem** criar regra de negócio nova
(dinheiro continua saindo só pelo ledger auditado, com o mesmo serviço do cron) e sem
expor dado pessoal além do necessário.

**Feito:**
- Migração `20261017120000_fase5_painel_admin`: valor `ADMIN` no enum `UserRole` e coluna
  `decidedById` em `IdentityVerification` (auditoria de quem decidiu cada verificação). O
  `ADMIN` é concedido à mão (Prisma Studio/script) — nenhuma rota o autoatribui.
- `src/lib/auth.ts`: `isAdmin(user)` (papel `ADMIN` **ATIVO`) e o tipo de sessão usado pelas rotas.
- `src/lib/internalAuth.ts`: `checkAdminAccess()` — aceita **segredo interno** (`x-internal-secret`,
  caminho da infra/testes, comportamento inalterado) **ou** **sessão com papel `ADMIN` ativo**
  (caminho do painel no navegador). Quando autentica por sessão, o `adminId` auditado é o **id do
  usuário logado**; no caminho do segredo, continua vindo do corpo (compatibilidade com testes/curl).
- Rotas `/api/admin/*` **existentes** (disputas e denúncias) migradas para `checkAdminAccess` e
  **enriquecidas** para a análise: partes com documento **mascarado**, lado que abriu a disputa e
  **autoria de cada evidência**.
- Rotas novas: `GET /api/admin/verifications` (fila, documento mascarado), `POST /api/admin/verifications/[id]/approve`
  (transação: `VERIFICADO` + papel `ATIVO` + perfil `VERIFICADO`), `POST /api/admin/verifications/[id]/reject`
  (motivo obrigatório, permite reenvio), `GET /api/admin/hirings`, `GET /api/admin/payouts`,
  `POST /api/admin/payouts/run-batch` (mesmo `processPendingPayouts()` do cron), `GET /api/admin/ledger`
  e `GET /api/admin/reconciliation` (leitura pura — reporta, nunca corrige nem move dinheiro).
- `GET /api/uploads/[...path]`: além do dono, conta com papel `ADMIN` enxerga `verifications/` e
  `private/` (as provas do painel). Continua **401 sem sessão** e **403 para terceiro** (Fase 1 intacta).
- `src/services/reportService.ts`: `listReports` enriquecido com contexto da contratação.
- `src/app/admin/page.tsx`: painel client-side (uma página, sem biblioteca nova) com login por
  sessão, abas Disputas / Denúncias / Identidade / Financeiro, decisões auditadas e visual neutro
  (nenhuma identidade visual inventada). Documento exibido sempre mascarado; anexos via `/api/uploads`.
- `.tools/test-fase5.ps1` (145 assertions, autossuficiente: concede `ADMIN` via Prisma como o
  operador faria uma vez) + `run-all-tests.ps1` com o passo **7/7**.

**Regras preservadas (Governança Financeira):** o lote do painel é o **mesmo** serviço do cron
(elegibilidade, chave de idempotência e ledger intactos); a reconciliação é leitura pura; denúncia
nunca move dinheiro; o histórico financeiro é append-only (correção manual é um `AJUSTE` novo); a
liberação manual/release continuam nas rotas internas com segredo.

**Correção de teste (código de produção íntegro):** `test-fase5.ps1` prependava `/api/uploads/` a
um `documentUrl` que **já** vinha como `/api/uploads/...`, gerando `/api/uploads//api/uploads/...`
(308). Ajustado para usar o caminho devolvido pela API — as 4 falhas eram só isso.

**Resultado dos testes (registro):**
- Fase 1: 15 + 8 + 12 = 35/35
- Fase 2: 112/112
- Fase 3: 103/103
- Fase 4: 202/202
- Fase 5: **145/145** — autorização das rotas admin (anônimo 403 / comum 403 / segredo 200 / sessão
  ADMIN 200), `ADMIN` não autoatribuível (400), fila de identidade mascarada (CPF completo não
  aparece), admin enxerga a prova e terceiro recebe 403 (anônimo 401), aprovação transacional
  (papel vira ATIVO), rejeição com motivo + reenvio, consultas (contratações/repasses/ledger),
  reconciliação `ok`, lote disparado pelo painel (hiring `LIBERADO`), disputa e denúncia decididas
  com o **id da sessão** auditado, denúncia sem mexer no ledger, e o caminho do segredo mantendo o
  `adminId` do corpo.
- Total do projeto: **597/597**
- `npx tsc --noEmit` limpo; `npm run build` de produção **limpo** (`/admin` prerenderizado, todas as
  rotas `/api/admin/*` presentes).

**Contas criadas pelos testes (descartáveis):** Fase 5 cadastra `empresa5@exemplo.com`,
`ana5@exemplo.com` e `bruno5@exemplo.com` (senha `senhaSegura123`, CPFs/CNPJ por módulo 11) e
concede `ADMIN` à conta da empresa via Prisma.

**Pendências herdadas/novas:** produção do Asaas (chave real + teste de transferência de baixo valor
antes do lote semanal); taxa do saque instantâneo (1% placeholder); persistência do relatório de
reconciliação para consulta histórica; painel de **métricas** (GMV/conversão/cancelamento) e as
**configurações financeiras editáveis** (comissão/taxa/boost) — o painel da Fase 5 cobre a operação,
não a edição de parâmetros; agendador real para `/api/cron/*`; notificação do código de abertura ao
profissional (Fase 6).

## Sessão 10 — Pós-auditoria: Etapa 1 (idempotência de cobrança) validada localmente

**Estado anterior:** nas rotas `/api/payments/create` e `/api/jobs/boost`, retry, resposta perdida do provedor ou duas requisições simultâneas podiam criar **duas cobranças** para a mesma operação; não havia registro de tentativas; o header `idempotencyKey` não é proteção primária (não documentado como garantia pelo Asaas).

**Estado final:** `chargeService.ts` coordena toda a criação de cobrança. Regras: (1) reconciliação com o provedor por `externalReference` **antes** de qualquer criação — ausência só é decretada com listagem **completa** (`hasMore === false`; truncada/ausente → 503, nada criado); (2) trava advisory transacional por operação é o primeiro statement da transação (exclusão mútua real); (3) cada tentativa registrada em `ChargeAttempt` (`PROVIDER_UNCONFIRMED`/`CONFIRMED`/`REJECTED`), estado ambíguo **nunca** cria sem prova; (4) falha ao persistir `providerPaymentId` não gera segunda cobrança (adoção no retry); (5) `UNIQUE(entity, entityId, attempt)` como backstop.

**Causa de cada alteração e arquivos:**
- `prisma/migrations/20261017150000_etapa1_idempotencia` (aditiva; aplicada) — tabela `ChargeAttempt` + `UNIQUE(entity,entityId,attempt)` + índice único `JobBoost.jobPostingId`.
- `src/services/chargeService.ts` — TOCTOU corrigido (leitura única + trava), `adoptAndReuse`, guarda de completude da listagem.
- `src/lib/asaas.ts` — `AsaasApiError` com status HTTP; `findPaymentsByExternalReference` agora expõe `hasMore` (`AsaasPaymentPage`).
- `src/app/api/payments/create/route.ts`, `src/app/api/jobs/boost/route.ts` — únicos chamadores de `ensureCharge` (503 sem credencial intacto).
- `.tools/mock-asaas.mjs` — passa a reproduzir o contrato real de listagem (`limit` padrão 10/máx. 100, `offset`, `hasMore`/`totalCount`) + `listMode: "incomplete"`; asserções do harness preservadas.
- `.tools/test-idempotencia.mjs` — cenário 10 aditivo (listagem incompleta → 503, zero criação, recuperação sem duplicata).

**Comandos e exit codes (registros em `%TEMP%\opencode`):**
- `npx tsc --noEmit` → **0**; `npm run build` → **0** (após as correções).
- Bateria completa `run-all-tests.ps1` → `bateria-final2.exit.txt` = **0**; log lido integral (912 linhas): Fases 1a/1b/1c/2/3/4/5 = 15+8+12+112+103+202+145 = **597/597**; Etapa 1 = **77/77**; `### TUDO OK`.
- 3 repetições do harness → `harness-rep1..3.exit.txt` = **0, 0, 0**; logs individuais lidos integrais: **77 OK / 0 FALHA** em cada uma (cenários 3/4 concorrentes com `1 criação`, respostas `200,409` e `1:CONFIRMED` nas 3 rodadas de cada).
- Preservados como evidência: `bateria-etapa1-r2.log` (execução anterior com exit perdido — corroboradora, não aprovadora), `bateria-r2b.log` (exit 0), `bateria-final.log` (bateria pós-correção com captura de exit falhada mecanicamente — refeita como final2 com captura confiável).

**Contagens:** verificações aprovadas = 597 (bateria) + 77 (Etapa 1 na bateria) + 77×3 (repetições) = **828**; reprovadas **0**; omitidas **0**; inconclusivas **1** execução histórica (exit numérico perdido — registrada como tal, nunca como sucesso).

**Integridade do ledger e dos registros históricos (evidências):** cenário 9 verde em 4 execuções (snapshot antes/depois: nenhum `LedgerEntry` criado/alterado/excluído, nenhuma contratação pré-existente alterada, nenhum repasse alterado). Conferência **independente** do banco pós-execução (fora do harness): zero `providerPaymentId` em duas `CONFIRMED`; todo alvo (`Hiring`/`JobBoost`) apontando exatamente para a última tentativa; zero `(entity,entityId,attempt)` duplicado; os 8 grupos com 2 `CONFIRMED` são re-tentativas legítimas pós-exclusão real (tentativas 1→2 com payment ids distintos, um par por execução × cenários 6/8e).

**Pendências da época (histórico — reconciliado em 2026-10-19):** (a) **Sandbox do Asaas** — na Sessão 10 a `ASAAS_API_KEY` estava vazia e **nada havia sido exercitado contra o provedor real**; depois, com credencial de Sandbox, a integração passou a ser exercitada (ver Sessões 11–12 e `findings.md`: `sandbox-etapa2.mjs` rodou em `sandbox.asaas.com`, exec4 exit 0, e o modo `--keep-charges` manteve cobranças reais vivas). **Continua PENDENTE** a transição financeira real (`CONFIRMED/RECEIVED → RETIDO`, chat, ledger, idempotência pós-confirmação) — depende de confirmação manual no console. (b) **`customer`** obrigatório no `POST /payments` (confirmado na doc oficial) — na Sessão 10 o payload **não** enviava o campo; **resolvido** depois com o fluxo "cliente por usuário" (`POST /customers` + `User.asaasCustomerId`), exercitado no Sandbox (cliente `cus_000009561631` criado 1× e reutilizado). (c) **paginação multipágina** (`offset`) para operações com >100 cobranças por `externalReference` (hoje só a primeira página, protegida pelo guard de completude) — **ainda aberta**.

**Riscos (contexto da Sessão 10 — parcialmente reavaliado):** a validação daquela sessão foi 100% local com mock; o contrato real **já foi** exercitado no Sandbox do Asaas (Sessões 11–12). Permanece válido: se o provedor real devolver `hasMore` ausente (desvio de contrato), a criação é bloqueada com 503 por segurança (comportamento desejado, monitorável).

**Critérios objetivos de liberação (Etapa 1):** (1) revisão humana deste diff; (2) credencial Sandbox + execução dos cenários 1–10 contra `sandbox.asaas.com` registrando identificadores de teste; (3) resolução do `customer`; (4) teste de transferência Pix de baixo valor (já exigido em `findings.md`) antes de liberar o lote semanal em produção.

## Sessão 11 — Pós-auditoria: decisão `customer` (cliente por usuário) implementada; harness da Etapa 2 preparado; validação local completa

**Decisões do responsável (2026-10-18):** a chave Sandbox será fornecida por você (`ASAAS_API_KEY` no `.env` + aviso) e o `customer` do `POST /payments` resolvido como **cliente por usuário** (na 1ª cobrança cria no provedor, persiste e reutiliza — não um cliente genérico de teste).

**O que foi implementado (aditivo, nenhum dado existente alterado):**
- `prisma/schema.prisma`: `User.asaasCustomerId String? @unique` + migração `20261018150000_etapa2_customer_usuario` (só `ADD COLUMN` + índice único); `prisma migrate deploy` aplicou com exit 0.
- `lib/asaas.ts`: tipo `AsaasCustomer`, `createAsaasCustomer()` (`POST /customers` — só dados já cadastrados: nome/razão social, e-mail, CPF/CNPJ só dígitos, telefone) e `createPixPayment` agora exige `customerId` → payload com `customer` (campo `required` da doc oficial).
- `services/chargeService.ts`: `ensureAsaasCustomerForUser()` — caminho rápido sem transação quando o id já existe; na 1ª cobrança, trava advisory `freelaz:asaas-customer:{userId}` → cria cliente → persiste `User.asaasCustomerId` (4xx do provedor → `rejected`/502 na rota; rede/5xx → `unavailable`/503, nada cobrado; P2002 → releitura). `ensureCharge` ganhou `customerId` obrigatório.
- Rotas `POST /api/payments/create` (contratante) e `POST /api/jobs/boost` (usuário autenticado): resolvem o cliente **antes** de `ensureCharge`; caminhos de reuso/adaptação continuam sem chamada extra.
- `.tools/mock-asaas.mjs`: agora **reproduz o contrato real** — `POST /v3/customers` (`name`+`cpfCnpj` obrigatórios, envelope `{errors:[{description}]}`), `GET /v3/customers/{id}`, e `POST /v3/payments` **recusa sem `customer` ou com cliente inexistente** (400 `invalid_customer`); estado expõe `customers` e `calls.createCustomer`.
- `.tools/test-idempotencia.mjs`: **cenário 11 aditivo** (7 asserções) — cliente criado 1× na 1ª cobrança, NENHUM cliente novo na 2ª operação, mesmo `customerId` no provedor/banco/pagamento.
- `.tools/sandbox-etapa2.mjs` (novo): harness da Etapa 2 para o provedor REAL com salvaguardas duras — aborta exit 2 se a URL não for `sandbox.asaas.com`, se a chave ou o token de webhook estiverem vazios; autenticação `access_token` (igual à lib); identificadores sem segredos; limpeza protegendo pagamentos já recebidos. Correções de fidelidade na revisão: `externalReference` real (`hiring.id` / `boost:{boost.id}` — não a idempotencyKey `freelaz:*`); webhook usa o **corpo real** do provedor e o cenário 5 afirma apenas o comportamento observável (sem confirmação no console → aceito e ignorado; RETIDO/ledger só com pagamento aprovado — `APPROVED_STATUSES = ["CONFIRMED","RECEIVED"]`).

**Validação local (evidências — exits capturados em arquivos próprios em `%TEMP%\opencode`):**
- `npx prisma generate` = 0; `npx prisma migrate deploy` = 0; `npx tsc --noEmit` → `tsc-etapa2.exit.txt` = **0**; `npm run build` → `build-etapa2.exit.txt` = **0**.
- Bateria `run-all-tests.ps1` → `bateria-etapa2.exit.txt` = **0**; log integral (921 linhas): Fases 1–5 = **597/597**, Etapa 1+2 = **84/84** (77 anteriores preservadas + 7 do cenário 11), `### TUDO OK` — total **681/681**, zero falhas reais.
- 3 repetições do harness → `harness-etapa2-rep1..3.exit.txt` = **0/0/0**; logs individuais: **84 OK / 0 FALHA** em cada.
- Conferência independente do banco (`check-etapa2.mjs`) → exit 0, **9/9**: coluna e índice únicos existem; toda contratação/boost com tentativa tem `asaasCustomerId` (0 violações); nenhum cliente usado por 2 usuários; regressões da Etapa 1 intactas (nenhum payment id em 2 `CONFIRMED`; alvos = última tentativa — conferência de boost corrigida para join por `b.id`, antes vacuada por `jobPostingId`; zero `(entity,entityId,attempt)` duplicado). Info: 4 usuários com cliente, 64 tentativas.
- Salvaguarda exercitada de verdade: `node .tools\sandbox-etapa2.mjs` sem chave → `ABORTADO (exit 2)` antes de qualquer chamada externa.

**Contagens desta sessão:** verificações aprovadas = 681 (bateria) + 252 (3×84) + 9 (banco) = **942**; reprovadas **0**; omitidas **0**.

**Pendências (não concluídas — não registrar como aprovadas):**
- **Etapa 2 (pós-auditoria) — testes automatizados passaram no Sandbox real; transição financeira real PENDENTE:** `sandbox-exec4.log` → `SANDBOX_EXIT=0`, 37 OK/0 FALHA. Credencial `$aact_hmlg_` autenticada, cliente `cus_000009561631` criado 1× e reutilizado, QR Pix válido, exclusão fantasma tratada por listagem como autoridade, cobranças `pay_z6qoyad1heidrjd1` e `pay_djewxnmap7wo669x` (hiring `cmvemrcbb0003fnf8a7xgn7wa`), `pay_n1wbx0jcb3h0d7dn` (hiring `cmvemrimr0007fnf8e4ymcqyk`), `pay_dtdmqdgut2zb23to` (boost), webhook/reenvio idempotentes sem alteração de estado enquanto PENDING. **BLOQUEIO verificado (2026-10-19):** todos os 4 pagamentos foram **excluídos na limpeza do cenário 8** (`deleted=true` + GET-by-id `PENDING` fantasma) → não podem ser confirmados no console. Ambos os hirings seguem `AGUARDANDO_PAGAMENTO`, 0 lançamentos de ledger, sem chat. **Restam (manuais):** criar nova cobrança real e mantê-la viva → confirmar no console → reenviar webhook → validar RETIDO/chat/ledger + idempotência de reentrega; reembolso/estorno pós-confirmação; transferência Pix (só se o Sandbox realizar).
- **Herdadas (não resolvidas):** paginação multipágina (`offset` > 100), taxa de saque instantâneo, métricas, agendador real.

## Sessão 12 — Etapa 2: bloqueio da limpeza diagnosticado; harness ganhou `--keep-charges` e `--verify`

**Objetivo:** retomar a validação da transição `CONFIRMED → RETIDO → chat ABERTO → RETENCAO` (única parte não comprovada da Etapa 2).

**Diagnóstico (sondas SOMENTE-LEITURA, sem escrita):**
- `GET /payments/pay_djewxnmap7wo669x` → HTTP 200, `status=PENDING`, **`deleted=true`**, `externalReference=cmvemrcbb0003fnf8a7xgn7wa`. Ou seja: a limpeza do cenário 8 apagou os próprios pagamentos de teste — o GET-by-id devolve o objeto "fantasma", mas não há mais cobrança ativa para confirmar.
- Mesmo resultado para `pay_z6qoyad1heidrjd1`, `pay_n1wbx0jcb3h0d7dn` (hiring `cmvemrimr0007fnf8e4ymcqyk`) e `pay_dtdmqdgut2zb23to` (boost) — **todos `deleted=true`**.
- **Associação corrigida:** `pay_djewxnmap7wo669x` pertence a `cmvemrcbb0003fnf8a7xgn7wa` (não ao hiring antes suposto). Estado: ambos os hirings `AGUARDANDO_PAGAMENTO`, **0** lançamentos, **sem** chat (nada fabricado).
- **Causa-raiz:** a limpeza (`.tools/sandbox-etapa2.mjs`, seção 8) é incondicional → inviabiliza a confirmação manual posterior.

**Correção mínima (autorizada pelo responsável):** `.tools/sandbox-etapa2.mjs` ganhou dois modos, **sem alterar o comportamento padrão**:
- `--keep-charges`: pula a limpeza, mantém as cobranças `PENDING` vivas e imprime os ids para confirmação manual no console;
- `--verify <hiringId>`: **não cria nada** — reconsulta o pagamento real, exige status aprovado, envia o webhook com o corpo REAL e verifica `RETIDO` + chat `ABERTO` + exatamente 1 `RETENCAO` (valor = bruto) + idempotência de reentrega (reenvio e evento tardio não duplicam).

**Execução desta sessão:**
- `node --check .tools\sandbox-etapa2.mjs` → exit **0**.
- Guard do `--verify` exercitado: `--verify cmvemrcbb0003fnf8a7xgn7wa` (pagamento `PENDING`) → **exit 1**, sem enviar webhook e sem alterar estado.
- `node .tools\sandbox-etapa2.mjs --keep-charges` → **exit 0, 37 OK / 0 FALHA**; 3 cobranças PENDING mantidas vivas (`deleted=false` confirmado por sonda): `pay_u8c161bwlhoox6bn` (ref `cmveqi5n80003t5drjb1f4gyu`), `pay_77rpr1rlzm2t717v` (`cmveqicd10007t5dr1w3vmvp6`), `pay_emsiz6eibte8ysgc` (boost `cmveqiedg000tfenkjm6nnqsb`).
- `npx tsc --noEmit` → exit **0**. `next build` → primeiro **exit 1 por EPERM** em `.next/trace` (dev server segurando `.next` — infraestrutura, não código); com o dev server parado → **exit 0**.
- Snapshot "antes" no banco: `cmveqi5n80003t5drjb1f4gyu` e `cmveqicd10007t5dr1w3vmvp6` em `AGUARDANDO_PAGAMENTO`, chat nenhum, 0 ledger; boost `PENDENTE`; global `RETENCAO=13, REEMBOLSO=4, LIBERACAO=6`.

**Estado (superado):** aguardava confirmação manual de `pay_u8c161bwlhoox6bn`; **resolvido na Sessão 13** (transição financeira provada).

## Sessão 13 — Etapa 2: transição financeira real COMPROVADA no Sandbox

**Gatilho:** o responsável confirmou manualmente os pagamentos no console do Sandbox.

**Verificação no provedor (sonda somente-leitura, ANTES de agir):** `pay_u8c161bwlhoox6bn` → `CONFIRMED`; `pay_77rpr1rlzm2t717v` → `RECEIVED`; `pay_emsiz6eibte8ysgc` → `RECEIVED` (todas `deleted=false`, `paymentDate=2026-10-19`). O export do usuário `Cobrancas.xlsx` (2026-10-19T13:38:36Z) mostrava as 3 como "Aguardando pagamento" **antes** da confirmação. O arquivo "Markdown colado" citado pelo usuário **não existe** no projeto (artefato de colagem).

**Execução:** `node .tools\sandbox-etapa2.mjs --verify cmveqi5n80003t5drjb1f4gyu` → **exit 0, 12 OK / 0 FALHA** (`%TEMP%\opencode\sandbox-verify.log`). Dev server próprio (`freelaz-dev-verify.log`), com 3 `POST /api/webhooks/asaas → 200`.
- V1/V2: pagamento real reconsultado (HTTP 200) e aprovado no provedor (`CONFIRMED`).
- V3: webhook aceito com o corpo real do provedor (HTTP 200).
- V4: contratação **`RETIDO`**. V5: chat **`ABERTO`** (id `cmvfbkd4o0002aq9gzd1vzoif`).
- V6/V7: exatamente **1** lançamento `RETENCAO`, valor = bruto (**80000 == 80000**).
- V9–V11: reenvio do mesmo evento aceito, **não** duplica e o estado permanece `RETIDO`.
- V12/V13: evento tardio `PAYMENT_RECEIVED` aceito e **não** duplica (continua 1).

**Comparação antes/depois (banco, preservando histórico):** `cmveqi5n80003t5drjb1f4gyu` `AGUARDANDO_PAGAMENTO → RETIDO`; global `RETENCAO 13 → 14` (**+1 exato**); `REEMBOLSO=4` e `LIBERACAO=6` **inalterados**; `ChargeAttempt=26` inalterado; os demais hirings (`cmvemrimr…`, `cmvemrcbb…`, `cmveqicd…`) e os boosts seguem inalterados.

**Classificação:** Etapa 2 → **`FASE 2 VALIDADA NO SANDBOX — REVISÃO PENDENTE`**. A Etapa 1 continua `CORREÇÃO IMPLEMENTADA — REVISÃO PENDENTE` (validação formal própria pendente).

**Pendências remanescentes:** reembolso/estorno pós-confirmação (não executado); transferência Pix (não executada); `pay_77rpr1rlzm2t717v` (hiring `cmveqicd10007t5dr1w3vmvp6`) e `pay_emsiz6eibte8ysgc` (boost `cmveqiedg000tfenkjm6nnqsb`) estavam aprovados no provedor mas **não processados** localmente — o primeiro foi validado na Sessão 14; o boost segue pendente.

## Sessão 14 — Rodada controlada de auditoria das Etapas 1 e 2 (Fases A–F)

**Fase A (reconsulta):** Sandbox confirmado por sonda somente-leitura; listagem paginada (`hasMore=false`, `totalCount=3`) + GET: `pay_u8c161bwlhoox6bn`=CONFIRMED, `pay_77rpr1rlzm2t717v`=RECEIVED, `pay_emsiz6eibte8ysgc`=RECEIVED (todas `deleted=false`). O Postgres portátil estava **parado** — reiniciado via `pg_ctl -D .tools\pgdata` (sem alterar dados); snapshot local OK.

**Fase B (2ª contratação):** `node .tools\sandbox-etapa2.mjs --verify cmveqicd10007t5dr1w3vmvp6` → **exit 0, 12 OK/0 FALHA** (`%TEMP%\opencode\sandbox-verify-faseB.log`). Pagamento `RECEIVED` (V2); contratação `RETIDO` (V4); chat `ABERTO` (id `cmvflor230002bl9rkcfok26r`, V5); exatamente 1 `RETENCAO=80000` (V6/V7); reentrega e evento tardio não duplicam (V9–V13). Antes→depois: `RETENCAO 14 → 15` (+1); demais hirings/boosts/`REEMBOLSO`/`LIBERACAO` inalterados; log com 3 `POST /api/webhooks/asaas → 200`.

**Fase C (boost — só inspeção):** o webhook processa **contratação e boost** (ramo `boost:{id}`): localiza `JobBoost` por `externalReference`, espera `PENDENTE` → grava `PAGO`+`providerPaymentId` e `jobPosting.urgentBoost=true`; **nenhum `LedgerEntry`** (boost não tem `hiringId`; é receita da plataforma), sem chat. Idempotência: já `PAGO` → `alreadyProcessed`; reentrega/evento tardio → no-op. **Lacuna real:** o `--verify` só cobre contratação — **não há verificador de boost**. Proposta mínima (aguardando autorização, **não implementada**): modo `--verify-boost <boostId>` espelhando o de contratação (GET no provedor; exigir aprovado; POST do webhook com corpo real; conferir `JobBoost=PAGO`+`providerPaymentId`, `JobPosting.urgentBoost=true`, **zero** `LedgerEntry` novo, sem chat; reentrega/evento tardio idempotentes). `pay_emsiz6eibte8ysgc` segue `RECEIVED` no provedor e `PENDENTE` local (divergência esperada por ausência de webhook).

**Fase D (Etapa 1 — idempotência):** revisado `services/chargeService.ts` + rotas `POST /api/payments/create` e `POST /api/jobs/boost` (reconciliação antes de criar; `pg_advisory_xact_lock` por operação; `claimAttempt` + `priorConfirmed` fechando a janela reconcile-then-claim; `hasMore !== false` ⇒ bloqueio 503; fantasma pós-DELETE tratado pela listagem; `FALHOU/DELETED` só encerrados por prova do provedor). Bateria `.tools\test-idempotencia.ps1` (provedor **mock**, 12 seções) → **exit 0, 92 OK / 0 FALHA** (`%TEMP%\opencode\faseD-idempotencia.log`). Cenário 10 cobre `hasMore=true` (bloqueio); 11 cliente 1×; 12 exclusão fantasma. **Todos os cenários são mock** — nenhum toca o Sandbox real; rodar cenários 1–10 contra o Sandbox exigiria **criar cobranças** (não autorizado). `ChargeAttempt.CONFIRMED` aqui significa "o provedor respondeu a criação", **não** pagamento confirmado.

**Fase E (regressão/preservação):** `npx tsc --noEmit` → exit **0** (sem alteração de código, build não reexecutado). Ledger por tipo após tudo: `RETENCAO qtd=15 soma=373000`, `REEMBOLSO qtd=4 soma=59500`, `LIBERACAO qtd=6 soma=79020`; **sem duplicata** de `RETENCAO` por contratação (15 distintas) nem de `providerPaymentId`; os 2 hirings retidos têm exatamente 1 `RETENCAO=80000`. A bateria mock criou apenas registros de teste próprios (ChargeAttempt 26→44; JobBoost 6→10) — a ficha financeira real (as 4 contratações rastreadas + os 3 boosts) ficou inalterada.

**Classificação:** Etapa 2 mantém **`FASE 2 VALIDADA NO SANDBOX — REVISÃO PENDENTE`** (agora com **2 contratações** comprovadas). Etapa 1 permanece **`CORREÇÃO IMPLEMENTADA — REVISÃO PENDENTE`** (código revisado + bateria mock 92 OK); falta a decisão formal sobre a exigência de cenários contra o Sandbox real, que demandariam autorização para criar cobranças.

## Sessão 15 — Boost validado no Sandbox (novo modo `--verify-boost`)

**Autorização (escopo fechado):** implementar `--verify-boost` no harness e validar **exclusivamente** o boost `cmveqiedg000tfenkjm6nnqsb` / `pay_emsiz6eibte8ysgc` (R$ 10,00) no Sandbox. Sem criar cobrança, sem confirmar pagamento manualmente, sem operação financeira destrutiva, sem alterar a lógica financeira do produto/webhook.

**Pré-condições (item 1, somente-leitura):** ambiente Sandbox; `pay_emsiz6eibte8ysgc` = `RECEIVED`, `deleted=false`, `externalReference=boost:cmveqiedg000tfenkjm6nnqsb`, R$10; `JobBoost` local `PENDENTE` (`amountCents=1000`, `jobPostingId=cmveqicch000ofenktd2bjegn`); anúncio `PREENCHIDA`/`urgentBoost=false`. Snapshot inicial: `ledger=25, chat=20, hiring=46, jobBoost=10`.

**Implementação (`.tools/sandbox-etapa2.mjs`, mínima):** novo modo `--verify-boost <boostId>` — GET real no provedor, exigência de aprovado (`CONFIRMED`/`RECEIVED`), checagem de associação (`id` = `providerPaymentId`, `externalReference`=`boost:{boostId}`, valor), POST do webhook com **corpo real** do provedor; confere `JobBoost=PAGO`+`providerPaymentId`, `JobPosting.urgentBoost=true`, **zero** `LedgerEntry`, **sem** chat/contratação; reentrega (mesmo evento) e evento tardio (`PAYMENT_RECEIVED`) idempotentes; retratos ordenados antes/depois provam preservação. **Recusa a execução ANTES de enviar webhook** se os dados do provedor não corresponderem ao boost. Endurecido também o parsing: `--verify`/`--verify-boost` **sem valor** agora abortam (exit 2), em vez de cair no fluxo padrão que cria cobranças.

**Validação local (argumentos, sem rede/side effects):** `node --check` → exit **0**; `--verify-boost` sem id → `ABORTADO (exit 2)`; `--verify-boost idInexistente...` → `FALHA VB0`, exit **1**, sem webhook.

**Execução real — `node .tools\sandbox-etapa2.mjs --verify-boost cmveqiedg000tfenkjm6nnqsb`:** **exit 0, 20 OK / 0 FALHA** (`%TEMP%\opencode\sandbox-verify-boost.log`). Provedor `RECEIVED` (VB5), `deleted=false` (VB6); webhook 200 (VB7); `JobBoost PENDENTE → PAGO` (VB8) com `providerPaymentId=pay_emsiz6eibte8ysgc` (VB9); `jobPosting.urgentBoost=false → true` (VB10); **ledger 25→25** (VB11), **chat 20→20** (VB12), **hiring 46→46** (VB13); reenvio e evento tardio 200 sem efeito (VB14–VB19); demais boosts inalterados (VB20). Snapshot posterior: boost `PAGO`, `urgentBoost=true`, contagens idênticas (`ledger=25, chat=20, hiring=46, jobBoost=10`). `tsc --noEmit` → exit **0**.

**Classificação:** **lacuna do boost fechada** — a transição real `RECEIVED → PAGO` está comprovada com a regra financeira correta (**nenhum** lançamento no ledger; nenhum chat/contratação). Etapa 2 mantém **`FASE 2 VALIDADA NO SANDBOX — REVISÃO PENDENTE`** (2 contratações + 1 boost). Etapa 1 permanece **`CORREÇÃO IMPLEMENTADA — REVISÃO PENDENTE`** (inalterada).

## Sessão 16 — Re-auditoria dos critérios de fechamento da Etapa 1 (matriz dos 10 cenários)

**Objetivo:** decidir, com evidência, se os critérios da Etapa 1 já definidos (Sessão 10) foram atendidos — **sem** inventar critérios nem alterar a classificação por conta própria. Nenhuma cobrança criada; nenhuma operação financeira; nenhum dado alterado para satisfazer critério.

**Evidência fresca produzida nesta sessão (execuções verificáveis):**
- Bateria mock `.tools\test-idempotencia.ps1` → **exit 0, 92 OK / 0 FALHA** (12 seções) — log `%TEMP%\opencode\etapa1-reaudit.log`. Tipos: rotas Next reais + Postgres real + provedor MOCK controlado (fault injection). Nada toca dinheiro real.
- Sonda **somente-leitura** de invariantes (`%TEMP%\opencode\etapa1-invariants.cjs`) → exit 0: `ChargeAttempt=62` (todas `CONFIRMED`), **zero** duplicata de `(entity,entityId,attempt)`, **zero** `providerPaymentId` em 2 `CONFIRMED`, **todo** alvo aponta para a última tentativa; ledger por tipo `RETENCAO 15 / REEMBOLSO 4 / LIBERACAO 6` (=25, inalterado); `chat=20`. A bateria mock só criou registros de teste próprios (`ChargeAttempt 44→62`; `JobBoost 10→14`) — a ficha financeira real ficou intacta.
- `npx tsc --noEmit` → exit **0**.

**Matriz dos 10 cenários (tipo de teste · evidência · resultado · precisa do Sandbox real?):**

| # | Cenário | Tipo | Evidência | Resultado | Sandbox real? |
|---|---|---|---|---|---|
| 1 | Resposta perdida do provedor → 503; retry adota (1 só criação) | Integração (rota real + mock, `createMode:drop`) | Bateria §1 (8 OK) | **PASS** | **Não** — não se induz "resposta perdida" no provedor real |
| 2 | Falha ao persistir `providerPaymentId` (conflito de unicidade) → 503, nada perdido; retry adota | Integração (constraint DB + mock `forced_id`) | Bateria §2 (6 OK) | **PASS** | Não — falha é local/mock |
| 3 | 2 requisições simultâneas, mesma contratação → 1 criação, 200/409 | Integração/concorrência | Bateria §3 (15 OK, 3 rodadas) | **PASS** | **Sim, factível** — já exercitado no Sandbox na Etapa 2 (`pay_n1wbx0jcb3h0d7dn`, 2×2) |
| 4 | 2 requisições simultâneas, mesmo boost → 1 boost, 1 criação | Integração/concorrência | Bateria §4 (15 OK, 3 rodadas) | **PASS** | Sim, factível (não exercitado p/ boost no Sandbox real) |
| 5 | Repetição sequencial → 200, mesma cobrança, `alreadyCreated` | Integração | Bateria §5 (4 OK) | **PASS** | **Sim, factível** — Etapa 2 exercitou reuso de cobrança real |
| 6 | Nova tentativa legítima após exclusão real → novo id, histórico preservado | Integração (mock DELETE) | Bateria §6 (4 OK) | **PASS** | **Sim, factível** — Etapa 2 (delete + nova cobrança `pay_djewxnmap7wo669x`) |
| 7 | Consulta do provedor indisponível (500) → 503, zero criação, zero tentativa | Integração (mock `listMode:fail500`) | Bateria §7 (5 OK) | **PASS** | **Não** — não se induz 500 no provedor real |
| 8 | Boost `FALHOU` não presume ausência de cobrança (readota; nova só após exclusão real) | Integração (mock + estado local) | Bateria §8 (6 OK) | **PASS** | Parcial — boost real existe (Etapa 2), mas o estado `FALHOU` só é induzível local |
| 9 | Preservação do ledger/histórico (nada criado/alterado/excluído) | Integração (snapshot antes/depois) | Bateria §9 (3 OK) + sonda de invariantes | **PASS** | Não — checagem é no banco local; corroborada por `RETENCAO +1` exato na Etapa 2 |
| 10 | Listagem incompleta (`hasMore=true`) → 503, ausência não provada | Integração (mock `listMode:incomplete`) | Bateria §10 (7 OK) | **PASS** | **Não** — truncamento não é induzível; mas o contrato real (`hasMore=false`) e o fantasma foram **observados** no Sandbox |

Cenários 11 (cliente 1× e reutilizado) e 12 (exclusão fantasma) — aditivos da Etapa 2 — também **PASS**, com **evidência no Sandbox real** (cliente `cus_000009561631`; fantasma tratado por listagem-como-autoridade).

**Cobertura das áreas exigidas (item 5):** concorrência → §3/§4; reconciliação antes da criação → §1/§6/§7/§8/§10; bloqueios transacionais (advisory lock + `UNIQUE`) → §2/§3/§4; referências externas → §6/§8/§10/§12 + Etapa 2; falhas de consulta → §7; paginação incompleta → §10; tentativas anteriores (`priorConfirmed`) → §1/§2/§5/§6/§8; cobranças excluídas → §6/§8/§12.

**`ChargeAttempt.CONFIRMED` ≠ pagamento aprovado.** Confirmado no código: `CONFIRMED` é gravado quando o **provedor respondeu à criação** (`chargeService.ts`, passo 4), enquanto o pagamento aprovado vem do **webhook** (`APPROVED_STATUSES=["CONFIRMED","RECEIVED"]`). Os 62 registros `CONFIRMED` incluem tentativas cujo pagamento **nunca** foi confirmado — não há confusão entre os dois.

**Confronto com os critérios já definidos (Sessão 10) — sem inventar novos:**
1. *(1) revisão humana do diff* → **em curso** (esta sessão entrega a revisão; falta o aceite humano).
2. *(2) credencial Sandbox + cenários 1–10 contra `sandbox.asaas.com`* → **NÃO atendido como escrito, e parcialmente INFACTÍVEL**: os cenários de fault-injection (§1, §7, §10; partes de §2 e §8) dependem de o provedor falhar sob comando, o que o Sandbox real não permite. Os cenários factíveis (§3, §5, §6) já têm execução real — mas pela Etapa 2, não pelo harness da Etapa 1.
3. *(3) resolução do `customer`* → **ATENDIDO** (Sandbox real: cliente 1× e reutilizado).
4. *(4) transferência Pix de baixo valor* → **NÃO executado** (exige operação financeira real; não autorizado).

**Conclusão/recomendação (Sessão 16):** `PENDENTE`. Há um critério em vigor (2) sem evidência direta e **contraditório com a realidade** (parte dele é infactível), e o critério (4) exige dinheiro real. Isso **não** é uma falha do código: **nenhum FAIL** foi observado (92/92 mock, invariantes limpos, `tsc` 0) — é uma lacuna de **definição de critério**. A classificação **permanece** `CORREÇÃO IMPLEMENTADA — REVISÃO PENDENTE` até decisão humana. Proposta de redefinição formal registrada em `task_plan.md` (aguardando aprovação).

## Sessão 17 — Fechamento formal da Etapa 1: revisão humana do diff e classificação final

**Decisão do responsável (2026-10-19):** definição de fechamento da Sessão 16 **APROVADA**, com classificação **`APROVADA COM RESSALVAS`**, condicionada à conclusão e registro da revisão humana do diff. Escopo restrito à Etapa 1 (não é aprovação de produção, nem autorização financeira, nem aprovação de fases seguintes).

**Arquivos revisados (revisão humana do diff de idempotência):**
- `src/services/chargeService.ts` (núcleo): `reconcile` (listagem por `externalReference`; ausência só com `hasMore === false`), `checkPersistedCharge` (fantasma pós-exclusão resolvido pela listagem como autoridade), `claimAttempt` (`pg_advisory_xact_lock` por operação + leitura única + `priorConfirmed`), re-reconciliação condicional (fecha a janela reconcile-then-claim), `adoptAndReuse`/`adoptCharge`, `persistToTarget` (tentativa antes do alvo), `ensureAsaasCustomerForUser` (trava por usuário + `P2002`).
- `src/app/api/payments/create/route.ts` e `src/app/api/jobs/boost/route.ts`: autorização/ownership, mapeamento de desfechos (`reused`/`concurrent`=409/`ambiguous`=503/`rejected`=502), `503` sem credencial intacto.
- `src/lib/asaas.ts`: `AsaasApiError` (4xx = definitivo ≠ rede/timeout = desconhecido), `findPaymentsByExternalReference` (expõe `hasMore`, `limit=100`), `isChargeActive`, `createPixPayment` (`customer` obrigatório), `getPixQrCode` (retry curto).
- `prisma/migrations/20261017150000_etapa1_idempotencia/migration.sql` e `20261018150000_etapa2_customer_usuario/migration.sql`: **100% aditivas** (só `CREATE TABLE`/`CREATE INDEX`/`ADD COLUMN`), sem alterar/excluir dados.
- `prisma/schema.prisma`: `ChargeAttempt` (`@@unique([entity, entityId, attempt])`, `providerPaymentId @unique`), `JobBoost.jobPostingId @unique`, `Hiring.providerPaymentId @unique`, `User.asaasCustomerId @unique`.
- `.tools/test-idempotencia.mjs` (cenários 1–12), `.tools/mock-asaas.mjs`, `.tools/sandbox-etapa2.mjs` (modos `--keep-charges`, `--verify`, `--verify-boost`).

**Resultado da revisão:** **nenhum bloqueador crítico.** As regras centrais estão corretas e coerentes: (1) nunca criar sem reconciliar antes; (2) serialização por trava advisory + unicidade como backstop; (3) estado ambíguo nunca cria (só prova do provedor encerra); (4) janela reconcile-then-claim fechada por `priorConfirmed`; (5) tentativa persistida antes do alvo. Sem escrita livre de status financeiro; sem PII nova; migrações aditivas.

**Verificações e invariantes confirmados (evidência fresca da Sessão 16, não reexecutada por ser somente-leitura/segura e recente):** bateria mock **exit 0, 92 OK / 0 FALHA**; sonda de invariantes limpa (`ChargeAttempt=62` todas `CONFIRMED`, zero duplicata de `(entity,entityId,attempt)`, zero `providerPaymentId` em 2 `CONFIRMED`, todo alvo = última tentativa; ledger `RETENCAO 15 / REEMBOLSO 4 / LIBERACAO 6` inalterado; `chat=20`); `tsc --noEmit` exit 0.

**Riscos residuais (não críticos; já documentados):**
- **Tentativa órfã + consistência eventual do provedor:** um processo morto no meio deixa `PROVIDER_UNCONFIRMED`; após `STALE_ATTEMPT_MS` (2 min) a próxima requisição a encerra como `RECONCILED_ABSENT` — **apenas** após a reconciliação (listagem completa) ter provado ausência. Se o provedor tiver latência de consistência na listagem, uma cobrança recém-criada poderia não aparecer e originar uma segunda. Mitigação parcial pelo `hasMore`/reconciliação; limitação inerente a qualquer solução sem idempotência garantida pelo provedor (`idempotencyKey` não documentado = best-effort). Não exige operação financeira para documentar; exige apenas ciência do risco.
- **Paginação multipágina (>100 por `externalReference`):** só a primeira página é lida; `hasMore !== false` ⇒ 503 (fail-closed, nunca duplica). Risco de **disponibilidade**, não de duplicidade. Aberto desde a Sessão 10.
- **Desvio de contrato do provedor** (`hasMore` ausente): tratado como incompleto ⇒ 503. Comportamento desejado e monitorável.

**Critérios explicitamente fora do escopo desta Etapa 1:** transferência Pix de baixo valor (gate independente de **produção**); reembolso/estorno pós-confirmação; paginação multipágina; taxa do saque instantâneo; produção do Asaas.

**Classificação final:** **`APROVADA COM RESSALVAS — critérios de fechamento aprovados; transferência Pix permanece como gate independente de produção.`** Justificativa: definição aprovada, revisão humana do diff concluída **sem bloqueador crítico**, critérios (a)+(b)+(d) atendidos e (c) parcialmente atendido pela Etapa 2; ressalvas residuais são não críticas e explicitamente aceitas/documentadas.

**Confirmações:** **nenhuma operação financeira** foi executada (sem cobranças novas, sem confirmação de pagamento, sem reembolso/estorno/transferência, sem alteração de ledger/saldos/contratações). **Nenhuma fase seguinte foi iniciada.** Etapa 2 permanece **`FASE 2 VALIDADA NO SANDBOX — REVISÃO PENDENTE`** (inalterada).

## Sessão 18 — Revisão formal da Etapa 2 (matriz de evidências Sandbox)

**Escopo:** revisão formal da Etapa 2 usando prioritariamente as evidências Sandbox já existentes. **Nenhuma cobrança criada; nenhuma confirmação de pagamento; nenhum reembolso/estorno/transferência; nenhum dado financeiro alterado; nenhum código de produção modificado; nenhuma fase iniciada.** Protocolos lidos: `VLAEG.md`, `progress.md`, `.protocol/task_plan.md`, `.protocol/findings.md`; código da rota de webhook (`src/app/api/webhooks/asaas/route.ts`, lido integralmente).

**Evidência fresca produzida nesta sessão (somente-leitura):**
- Sonda de banco apenas-leitura (`%TEMP%\opencode\etapa2-review-probe.cjs`) → exit 0: contratação `cmveqi5n80003t5drjb1f4gyu` = **`RETIDO`**, `providerPaymentId=pay_u8c161bwlhoox6bn`, **1 `RETENCAO`=80000**, chat `ABERTO`; contratação `cmveqicd10007t5dr1w3vmvp6` = **`RETIDO`**, `providerPaymentId=pay_77rpr1rlzm2t717v`, **1 `RETENCAO`=80000**, chat `ABERTO`; boost `cmveqiedg000tfenkjm6nnqsb` = **`PAGO`**, `providerPaymentId=pay_emsiz6eibte8ysgc`, `jobPosting.urgentBoost=true`; ledger `RETENCAO 15 / REEMBOLSO 4 / LIBERACAO 6`; **zero** `RETENCAO` duplicada por contratação; contagens `hiring=58, jobBoost=14, ledger=25, chat=20, payout=6, chargeAttempt=62`; nenhum `Payout`/`REEMBOLSO` para as entidades rastreadas.
- `npx tsc --noEmit` → exit **0** (código inalterado nesta revisão).

**Matriz de cenários (tipo · evidência · resultado · risco residual · ação · impacto):**

| Cenário | Evidência existente | Tipo | Resultado | Risco residual | Ação necessária | Impacto na aprovação |
|---|---|---|---|---|---|---|
| Criação de cobrança de contratação | `sandbox-exec4.log` §1 (`pay_z6qoyad1heidrjd1`); `sandbox-keepcharges.log` §1 (`pay_6v3jhje82hi76pz7`) | Sandbox real | **PASS** | — | — | Corrobora |
| `customer` por usuário (criado 1×, reutilizado) | exec4 §1c–1e (`cus_000009561631`); mock §11 (84 OK) | Sandbox real + mock | **PASS** | Cliente órfão inócuo se o processo morrer entre criar e persistir | — | Corrobora |
| QR Pix real | exec4 §2 (2a/2b/2c) | Sandbox real | **PASS** | — | — | Corrobora |
| Repetição reusa a mesma cobrança | exec4 §3 / keepcharges §3 (3a–3d; `hasMore=false`) | Sandbox real | **PASS** | — | — | Corrobora |
| Concorrência 2 requisições (contratação) | exec4 §6 (respostas `200,409`; 1 ativa; 1 `CONFIRMED`) | Sandbox real | **PASS** | — | — | Corrobora |
| Exclusão real + nova tentativa (fantasma) | exec4 §4 / keepcharges §4 (`pay_...` → `pay_u8c161bwlhoox6bn`; 2 `CONFIRMED`); sonda: tentativas 1/2 `CONFIRMED` | Sandbox real | **PASS** | — | — | Corrobora |
| Webhook com pagamento `PENDING` → **não** aprovado | exec4 §5 (5a `PENDING`, 5c `AGUARDANDO_PAGAMENTO`, 5d 0 `RETENCAO`) | Sandbox real | **PASS** | — | — | Corrobora |
| Webhook aprovado → `RETIDO` + chat + retenção (contratação #1) | `sandbox-verify.log` (12 OK: `CONFIRMED→RETIDO`, chat `ABERTO`, 1 `RETENCAO`=80000) | Sandbox real | **PASS** | — | — | Corrobora |
| Webhook aprovado → `RETIDO` + chat + retenção (contratação #2) | `sandbox-verify-faseB.log` (12 OK: `RECEIVED→RETIDO`, chat `ABERTO`, 1 `RETENCAO`=80000) | Sandbox real | **PASS** | — | — | Corrobora |
| Webhook repetido e tardio (contratação) | verify logs V9–V13 (reenvio + `PAYMENT_RECEIVED` **não** duplicam); `test-fase4.ps1` §1/§1b (duplicado + 2 simultâneos) | Sandbox real + local/DB | **PASS** | — | — | Corrobora |
| Autenticidade do webhook (`token`) | `test-fase4.ps1` §1 (forjado→401, valor errado→400, desconhecido→404) | Local/DB | **PASS** | Segredo compartilhado, sem HMAC (by design do Asaas) | — | Corrobora |
| Boost `RECEIVED→PAGO` + `urgentBoost`, zero ledger | `sandbox-verify-boost.log` (20 OK) | Sandbox real | **PASS** | — | — | Corrobora |
| Boost reentrega/evento tardio idempotentes | verify-boost VB14–VB19 | Sandbox real | **PASS** | — | — | Corrobora |
| Idempotência dos efeitos internos (sem `RETENCAO` duplicada) | `test-fase4.ps1` §1; sonda fresca: `retencao_duplicada_por_hiring=[]`; 1 `RETENCAO` por contratação | Local/DB + Sandbox real | **PASS** | — | — | Corrobora |
| Preservação do ledger/histórico | VB11 (25→25); verify (+1 exato); sonda fresca (`15/4/6`; sem duplicata) | Local/DB + Sandbox real | **PASS** | — | — | Corrobora |
| Reembolso/estorno pós-confirmação (`PAYMENT_REFUNDED`) | Ramo `REFUNDED` no webhook (código revisado) — **nunca executado** com pagamento real | **NOT RUN** | **BLOCKED** | Ramo de estorno não exercitado ponta a ponta | Executar em Sandbox antes de produção | Gate de **produção** (ressalva) |
| Chargeback | Ramo explícito + `AsaasEvent`/`ChargebackEvent` (Etapa 3); bloqueio de repasse e disputa vinculada exercitados no **mock** | Mock controlado (Etapa 3 = 60 OK) | **PASS (mock)** | Payload real de `payment.chargeback` e contrato real de auth **não confirmados** | Confirmar contrato/payload reais e, se o Sandbox permitir, um chargeback de teste | Gate de **produção** (ressalva) |
| Transferência Pix de saída (repasse) | Nunca executada (Sandbox; exige destinatário) | **NOT RUN** | **BLOCKED** | Repasse real não comprovado | Uma transferência de baixo valor antes do lote | Gate de **produção** (ressalva) |
| Paginação multipágina (>100 por `externalReference`) | Guard `hasMore` fail-closed (`reconcile`); não exercitado com >100 | **NÃO EXECUTADO** | **BLOCKED** | Disponibilidade (nunca duplica) | Implementar `offset` antes de produção | Ressalva |
| Reembolso **antes** da confirmação (`PAYMENT_DELETED → CANCELADO`) | Ramo `DELETED` (código) + delete real exec4 §4/§8 | Sandbox real (delete) / local | **PASS (parcial)** | Transição `CANCELADO` via webhook não observada com corpo real | Baixa prioridade | Corrobora |

**Conclusões:** (1) a **transição financeira real** está comprovada no Sandbox para **2 contratações** e **1 boost**; (2) **pagamentos pendentes não são tratados como aprovados** (exec4 §5c/5d; `APPROVED_STATUSES`); (3) **eventos repetidos/tardios não duplicam** retenções nem ativações (V9–V13, VB14–VB19, fase4 §1/§1b); (4) a **autenticidade** do webhook é validada por token timing-safe antes de qualquer efeito; (5) a **consulta ao provedor** é feita com credencial (`getPayment`) antes de agir; (6) o **ledger/histórico** está preservado (sonda fresca, sem duplicata); (7) permanecem **NÃO EXECUTADOS** (bloqueados por exigirem operação real): **reembolso/estorno pós-confirmação, chargeback e transferência Pix** — além da paginação multipágina.

**Recomendação:** **`APROVADA COM RESSALVAS`** — o caminho crítico (cobrança → webhook → retenção → chat → ledger; boost sem ledger) está comprovado no Sandbox e é idempotente; as ressalvas são operações financeiras **não executadas** nesta rodada (reembolso/estorno, chargeback, transferência Pix) e a paginação multipágina, todas tratáveis como **gates de produção**. **A classificação oficial permanece `FASE 2 VALIDADA NO SANDBOX — REVISÃO PENDENTE` até aceite humano explícito da recomendação** (não há reclassificação unilateral).

## Sessão 19 — Etapa 3 (pós-auditoria): webhook/chargeback Asaas (IMPLEMENT + TEST + REVIEW)

**Escopo autorizado:** implementação em código, banco de dev/testes, **migrações aditivas** e **Sandbox**. **NÃO autorizado (e não executado):** produção, cobranças/estornos/reembolsos/saques/transferências reais, alteração de credenciais de produção, movimentação de dinheiro. Nenhum ledger histórico foi editado/apagado; nenhuma fase anterior foi reclassificada — esta é uma **nova etapa**.

**Correções implementadas (7 frentes):**

1. **Autenticação do webhook por cabeçalho oficial.** `isAuthenticAsaasWebhook(req, body)` em `src/lib/asaas.ts`: valida **sempre** o cabeçalho `asaas-access-token` (comparação timing-safe) e **só** aceita o fallback `body.token` quando `NODE_ENV=test`/`ASAAS_WEBHOOK_ALLOW_BODY_TOKEN=1` (explicitamente ligado em teste). O caminho antigo (só `body.token`) foi eliminado — `body.token` **não** contorna a autenticação fora do teste (asserção dedicada).
2. **Persistência durável antes do ACK.** Novo modelo **`AsaasEvent`** (aditivo) grava cada entrega (id do evento, tipo, `externalReference`/payment id, hash do payload, status de processamento, ação, erro) **antes** de responder 200. Falha ao persistir → 5xx para o Asaas reenviar (contrato at-least-once documentado).
3. **Idempotência por `event.id`.** `asaasEventId` é **único**; reenvio idêntico (mesmo id) é **no-op** seguro — não repete efeito financeiro, não duplica `Dispute`, não duplica `RETENCAO`. Entregas simultâneas do mesmo id convergem em **uma** linha de evento e **uma** retenção (asserções de concorrência).
4. **Bloqueio transacional de repasse.** `releasePayout`, `releasePayoutManually` e o lote (`processPendingPayouts`) usam a guarda autoritativa `payoutBlockReason(tx, hiringId)` **dentro da transação** com `SELECT … FOR UPDATE` (via `lockHiringForUpdate`): repasse é **recusado** (422, `Payout` marcado `FALHOU`, **zero** `LIBERACAO`) enquanto houver **chargeback ativo** ou **disputa interna aberta**. A guarda pré-existente é só uma otimização; a **guarda no commit prevalece**. A fila do lote exclui candidatos com `disputeOpen` ou chargeback ativo (não polui a fila nem marca FALHOU indevidamente).
5. **Endurecimento de disputas.** `openDispute` e `resolveDispute` passaram a travar a linha (`FOR UPDATE`) e **reler** o estado antes de agir (`claimDisputeForResolution`); duas aberturas concorrentes resultam em **uma** disputa aberta.
6. **Ramos de chargeback no webhook.** `asaasEventService.ts` (`handleChargebackEvent`) trata os 3 eventos oficiais (`PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`): registra o fato externo em **`ChargebackEvent`** (novo modelo aditivo; status/motivo externos **preservados** sem tradução; valor em centavos), **vincula/abre** a disputa interna, **bloqueia** o repasse e **SINALIZA** para conciliação humana. **Nenhum `REEMBOLSO` é criado no evento inicial** (D7). Após `LIBERADO`, o chargeback é **registrado e sinalizado** (`disputeOpen=true`) mas **NÃO reverte** o pagamento automaticamente (governança). `getPaymentChargeback` em `src/lib/asaas.ts` consulta o provedor (404 → `null`; outras falhas **lançam**).
7. **Eventos desconhecidos preservados, sem suposição.** Evento cujo **nome** não está em `KNOWN_PAYMENT_EVENTS` → **`NAO_TRATADO`** (auditável, sem efeito). Evento **conhecido** sem efeito de estado → **`IGNORADO`**. Nunca se presume que "evento novo é inofensivo".

**Rotas admin novas (auditadas, sem payload bruto):** `GET /api/admin/chargebacks` (lista eventos de chargeback por `checkAdminAccess`) e `POST /api/admin/payouts/{id}/release-manual` (repasse manual de admin com a **mesma guarda transacional**; `adminId` da sessão ou do corpo, auditado).

**Arquivos alterados/criados:** `prisma/schema.prisma` (`AsaasEvent`, `ChargebackEvent`, relações reversas em `Hiring`/`Dispute`); `prisma/migrations/20261020120000_etapa3_asaas_eventos_chargeback/migration.sql` (**aditiva**, aplicada); `src/lib/asaas.ts`; `src/services/asaasEventService.ts` (novo); `src/services/payoutService.ts`; `src/services/disputeService.ts`; `src/app/api/webhooks/asaas/route.ts`; `src/app/api/admin/chargebacks/route.ts` (novo); `src/app/api/admin/payouts/[id]/release-manual/route.ts` (novo); `.tools/test-chargeback.mjs` + `.tools/test-chargeback.ps1` (novos, 9 seções); `.tools/mock-asaas.mjs` (controle `seedPayment`); `.tools/test-fase4.ps1`, `.tools/test-fase5.ps1`, `.tools/sandbox-etapa2.mjs` (contrato de cabeçalho + `event.id`); `.tools/run-all-tests.ps1` (passo **9/9**).

**Testes executados (todos versionados no repositório):**
- Bateria completa `.tools/run-all-tests.ps1` → **`BATTERY_EXIT=0`**, `### TUDO OK`. Totais: Fase 1a **15** + 1b **8** + 1c **12** + Fase 2 **112** + Fase 3 **103** + Fase 4 **202** + Fase 5 **145** = **597**; **Etapa 1+2 = 92**; **Etapa 3 (chargeback/webhook) = 60** → **749 OK / 0 FALHA**.
- `npx tsc --noEmit` → exit **0**; `npm run build` → **exit 0** (`✓ Compiled successfully`, rotas `/api/admin/chargebacks` e `/api/admin/payouts/[id]/release-manual` presentes).
- A bateria da Etapa 3 sobe o dev server apontando `ASAAS_API_URL` para o **mock** (`.tools/mock-asaas.mjs`) com `PAYOUT_SANDBOX=1` e restaura o servidor normal ao final — **nenhum dinheiro real** em jogo.

**Decisões humanas pendentes (D1–D8, não decididas silenciosamente):** só as **proteções independentes** foram implementadas. Permaneceram abertas: (D1) o que fazer quando o chargeback chega **após `LIBERADO`** (hoje: registrar+sinalizar, sem reverter); (D2) como tratar **déficit** sem saldo elegível; (D3) chargeback **parcial**; (D4) relação disputa **externa × interna**; (D5) quem pode intervir (admin autorizado + auditoria); (D6) critério de **desbloqueio** (hoje só desfecho verificável ou decisão humana registrada); (D7) **quando** registrar `REEMBOLSO`; (D8) **prazo/procedimento** da conciliação (data/prazo registrados, disputa **não** encerrada silenciosamente).

## Sessão 20 — Etapa 3.1: git + P1–P5 conferidos na doc oficial + fixture versionado

**Escopo autorizado:** versionamento git, consulta à documentação oficial do Asaas e fixture versionado. **NÃO autorizado (e não feito):** escolher D1–D8, mexer em produção, alterar credenciais de produção, remover/alterar a migração `20261020120000_etapa3_asaas_eventos_chargeback`.

**Feito:**
1. **[R1] Repositório git inicializado.** O `git` não existia no PATH; instalado **portátil** em `.tools\PortableGit` (Git 2.56.0; o `winget` travou e o download oficial do GitHub exigiu retomada por `curl -C -`). `.gitignore` na raiz cobre `.env`/`.env.*` (com `!.env.example`), `node_modules/`, `dist/`, `.next/`, `coverage/`, `*.tsbuildinfo`, `*.log`, uploads, toolchain (`node`, `portablegit`, `pgdata`, `pg`, `tarballs`, zips) e o `opencode-desktop-*.exe`. **`.env` verificado ignorado** (`git check-ignore -v`); nenhum `.env` versionado. Commit inicial **`fa4066d`** — `chore: estado inicial Etapa 3 (chargeback Asaas)` (133 arquivos, só fonte; maior arquivo 74 KB). NÃO é repositório remoto — rollback continua sendo reversão manual.
2. **[P5] Base URL do Sandbox.** Doc oficial: **`https://api-sandbox.asaas.com/v3`**. O `.env` usa o **legado** `https://sandbox.asaas.com/api/v3` (ambos respondem 401 sem credencial — alias ativo). `src/lib/asaas.ts` ganhou comentário; **`.env` NÃO alterado** (decisão do usuário: só registrar).
3. **[P1] Auth do webhook.** Cabeçalho **`asaas-access-token`**; `authToken` **por webhook**; **sem HMAC**. Código já correto — nada a mudar.
4. **[P2/P3/P4] Payload/estabilidade/semântica/retry.** `chargeback` vive **dentro de `payment`** no webhook (objeto **enxuto**, ex. só `status`+`reason`); o objeto **completo** é do GET `/payments/{id}/chargeback` (`disputeStartDate`, `deadlineToSendDisputeDocuments`, `disputeStatus`). `AWAITING_CHARGEBACK_REVERSAL` = **"Disputa vencida, aguardando repasse"** (venceu a plataforma; próximo evento `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`). Retry: backoff 0→3h e **fila pausada após 15 falhas** (eventos por 14 dias). Código **corrigido** (ver abaixo) e **fixture versionado** criado.
5. **[Código] Duas divergências reais corrigidas:** (a) o parser lia `body.chargeback` (topo) — agora lê **`payment.chargeback`** (contrato), com o topo só como fallback legado; (b) `createdDate`/`updatedDate` **não existem** → passou a ler **`disputeStartDate`/`deadlineToSendDisputeDocuments`/`disputeStatus`**. Tipos ajustados em `asaas.ts` (`AsaasChargeback`). Migração **aditiva** `20261020150000_etapa31_chargeback_campos_doc` (3 colunas nulas; nomes legados mantidos). Comentário de `externalStatusForEvent` corrigido para a semântica P3 (sem mudar o bloqueio conservador — D6 segue pendente).
6. **[Fixture] `.tools/fixtures/asaas-chargeback.json`** versionado, com `_source` e `_captured_at` (2026-10-20), os 3 eventos em **dois formatos** (webhook enxuto / GET completo) e os enums oficiais. **Não** é captura de tráfego.
7. **[Sandbox] `.tools/sandbox-chargeback-real.mjs`** (novo; somente leitura; guarda de Sandbox). A doc confirma que **chargeback no Sandbox exige solicitação por e-mail** (`integracoes@asaas.com.br`) — **não há gatilho self-service**. Sem chargeback observado → **`PENDENTE` (exit 3)**, nunca "validado".
8. **[Testes] `.tools/test-chargeback.mjs` §4b** (nova): envia o fixture no formato REAL do webhook e no formato completo do GET, provando a leitura de `payment.chargeback`, `disputeStatus`, `disputeStartDate`, `deadlineToSendDisputeDocuments`, `value`→centavos e `reason` preservado.

**P1–P5: RESOLVIDOS por documentação oficial (2026-10-20)** — tabela com fonte em `findings.md`. **Nada foi marcado resolvido por inferência.** P5 tem **divergência de `.env` mantida** (decisão do usuário).

**Arquivos alterados/criados:** `.gitignore` (raiz, novo); `.git` (novo); `freelaz-backend/prisma/schema.prisma` (3 colunas aditivas em `ChargebackEvent`); `freelaz-backend/prisma/migrations/20261020150000_etapa31_chargeback_campos_doc/migration.sql` (nova, aditiva, aplicada — 8 migrações no total); `freelaz-backend/src/lib/asaas.ts`; `freelaz-backend/src/services/asaasEventService.ts`; `.tools/fixtures/asaas-chargeback.json` (novo); `.tools/sandbox-chargeback-real.mjs` (novo); `.tools/test-chargeback.mjs` (§4b). **Nenhum arquivo de política D1–D8 foi alterado para "resolver" política.** A migração `20261020120000_...` **não** foi tocada.

**Estado da bateria:** `tsc --noEmit` exit 0; `npm run build` exit 0; `.tools/test-chargeback.ps1` (§4b incluída) e `.tools/run-all-tests.ps1` re-executados (ver contagem abaixo).

## Sessão 21 — Etapa 3.2: agendador de jobs (rotas + idempotência + agendamento documentado)

**Escopo autorizado:** código + testes + docs do agendador. **NÃO autorizado (e não feito):** D1–D8, Sandbox real do Asaas, alterar `.env` real, alterar migrações existentes.

**Feito:**
1. **[INSPECT] Mapeamento dos jobs** (registrado em `findings.md`): `generateOpeningCodesDue` / `generateClosingCodesDue` (`codeService.ts`), `processPendingPayouts` (`payoutService.ts`), `runReconciliation` (`reconciliationService.ts`). **Todos já eram idempotentes por estado** (a condição de elegibilidade deixa de casar após o efeito). **LACUNA registrada:** não existia agendador nem registro genérico de execução de job. **Decisão:** não criar chave de idempotência sintética — seria redundante; a idempotência é **observável** e foi **testada**.
2. **[IMPLEMENT] 4 rotas finas** `POST /api/jobs/{opening-codes,closing-codes,weekly-payout,daily-reconciliation}/run` — só traduzem HTTP → service. **Nenhuma regra de negócio na rota.**
3. **[IMPLEMENT] Auth dedicada** `src/lib/jobsAuth.ts` (`checkJobsToken`): cabeçalho `x-jobs-token` vs `JOBS_RUN_TOKEN`, comparação **timing-safe** (mesmo padrão do webhook), token nunca logado. 401 sem token/errado; **401 por padrão** quando o token não está configurado (escape hatch explícito `JOBS_ALLOW_UNTOKEN=1` só em dev); em produção sem token → **401** (nunca aberto).
4. **[IMPLEMENT] `.env.example`:** `JOBS_RUN_TOKEN=""` (placeholder + instrução de gerar ≥32 chars aleatórios) e `JOBS_ALLOW_UNTOKEN=""`. **`.env` real NÃO foi tocado.**
5. **[IMPLEMENT] `.tools/run-jobs.mjs`:** dispara os jobs (todos ou `--job=<nome>`) contra `http://127.0.0.1:3000`, lê o token do `.env` **sem imprimir**, sem `Tee-Object`.
6. **[TEST] `.tools/test-jobs.mjs` + `.tools/test-jobs.ps1`** (versionados; passo **10/10** da bateria): 401 sem/errado token; 200 com token; **idempotência observada** (opening/closing/weekly: 1ª gera, 2ª → 0, contagens antes/depois); reconciliação somente-leitura (ledger/payouts inalterados); **rota inexistente → 404**.
7. **[DOC] Agendamento** (`findings.md` → "Agendamento de jobs"): **Opção A escolhida (GitHub Actions cron)** — o projeto **não tem deploy Vercel** (sem `vercel.json`), então a Opção B não se aplica hoje; Actions é grátis e não depende de deploy. Exemplo de YAML com `secrets.JOBS_RUN_TOKEN` e a lista explícita do que **NÃO** fazer (`setInterval` no processo — não sobrevive a restart).

**Estado da bateria (executada, não declarada):** `npx tsc --noEmit` exit **0**; `npm run build` exit **0**; `.tools/run-all-tests.ps1` → **`BATTERY_EXIT=0`**, `### TUDO OK`. Totais: Fase 1a **15** + 1b **8** + 1c **12** + Fase 2 **112** + Fase 3 **103** + Fase 4 **202** + Fase 5 **145** = **597**; Etapa 1+2 **92**; Etapa 3 **74**; **Etapa 3.2 (jobs) 29** → **792 OK / 0 FALHA**. `run-all-tests.ps1` agora tem **10 passos** (o 10/10 é `test-jobs.ps1`).

**Arquivos criados:** `src/lib/jobsAuth.ts`; `src/app/api/jobs/{opening-codes,closing-codes,weekly-payout,daily-reconciliation}/run/route.ts`; `.tools/run-jobs.mjs`; `.tools/test-jobs.mjs`; `.tools/test-jobs.ps1`.
**Arquivos alterados:** `.env.example` (só placeholders); `.tools/run-all-tests.ps1` (passo 10/10); `.protocol/findings.md`, `.protocol/progress.md`, `.protocol/task_plan.md`.
**Não alterados:** `.env`, `payoutService.ts` (nenhuma mudança), migrações existentes, qualquer arquivo de D1–D8.

## Sessão 22 — Etapa 3.3: hardening do agendador + visibilidade de chargeback + template D1–D8

**Escopo autorizado:** hardening (`JOBS_ALLOW_UNTOKEN`), visibilidade read-only de chargeback, log estruturado, workflow GitHub Actions (arquivo, sem secrets) e template de decisão D1–D8. **NÃO autorizado (e não feito):** implementar D1–D8, Sandbox real, alterar migrações existentes, alterar `.env` real, tocar `payoutService.ts` além do necessário.

**Feito:**
1. **[IMPLEMENT] Guard de produção** — `isUntokenJobsForbidden(nodeEnv, allowUntoken)` + `assertJobsAllowUntokenSafe(...)` em **`src/lib/jobsStartup.ts`** (módulo puro, sem `crypto`/`next/server`). `src/instrumentation.ts` (`register()`, habilitado por `next.config.js` > `experimental.instrumentationHook`) chama a assertiva **no startup** (só no runtime Node): `NODE_ENV=production` + `JOBS_ALLOW_UNTOKEN=1` → app **não sobe**. **Limite observado:** `next dev` força `NODE_ENV=development`, então o caso "produção" é testado pela **função pura real** (compilada no harness), cobrindo os 3 casos.
2. **[IMPLEMENT] `GET /api/admin/chargebacks/blocked`** — `{ total, porStatus, maisAntigo }`, **somente leitura**; critério extraído para `chargebacksBlockingPayout` (`asaasEventService`) — o mesmo de `payoutBlockReason`/`hasActiveChargeback`. Guarda `checkAdminAccess`. NÃO desbloqueia, NÃO altera `state`/`payoutBlockReason`, NÃO devolve PII.
3. **[IMPLEMENT] Log estruturado na reconciliação** — `POST /api/jobs/daily-reconciliation/run` emite 1 linha sem PII: `chargebacks bloqueando repasse=N mais antigo há X dia(s)`. Não altera `ok`/`discrepancies` (o `runReconciliation` segue puro).
4. **[IMPLEMENT] `.github/workflows/jobs.yml`** — 4 schedules (opening/closing a cada 15 min, weekly segunda 03:00 UTC, daily 04:00 UTC) + `workflow_dispatch`, chamando `${JOBS_URL}/api/jobs/<job>/run` com `x-jobs-token`. **Nenhum secret criado** — documentado que só roda quando `JOBS_URL` for configurado.
5. **[DOC] `.protocol/decisions/D1-D8.md`** — matriz de apoio à decisão (8 decisões, alternativas com prós/contras e impacto em código/schema), **nenhuma alternativa marcada**, com a nota "não implementar sem aprovação".
6. **[TEST]** `.tools/test-jobs.mjs` (+ `.ps1` compila o helper e passa `JOBS_STARTUP_HELPER`/`JOBS_DEV_LOG`) e `.tools/test-chargeback.mjs` (§6d, endpoint com 2 chargebacks em estados distintos + 1 encerrado). Ambos versionados.

**Arquivos criados:** `src/lib/jobsStartup.ts`; `src/instrumentation.ts`; `src/app/api/admin/chargebacks/blocked/route.ts`; `.github/workflows/jobs.yml`; `.protocol/decisions/D1-D8.md`.
**Arquivos alterados:** `src/lib/jobsAuth.ts` (reexporta o helper); `src/services/asaasEventService.ts` (+`chargebacksBlockingPayout`, aditivo); `src/app/api/jobs/daily-reconciliation/run/route.ts` (log); `next.config.js` (`instrumentationHook`); `.env.example` (aviso de proibição); `.tools/{test-jobs.mjs,test-jobs.ps1,test-chargeback.mjs}`; `.protocol/{findings,progress,task_plan}.md`.
**Não alterados:** `.env` real, `payoutService.ts` (nenhuma mudança), migrações `20261020120000...`/`20261020150000...`, qualquer service/política de D1–D8.

**Estado da bateria (executada, não declarada):** `tsc --noEmit` exit **0**; `npm run build` exit **0**; `.tools/run-all-tests.ps1` → **`BATTERY_EXIT=0`**, `### TUDO OK`. Totais: Fase 1a **15** + 1b **8** + 1c **12** + Fase 2 **112** + Fase 3 **103** + Fase 4 **202** + Fase 5 **145** = **597**; Etapa 1+2 **92**; Etapa 3 **82**; Etapa 3.2 (jobs) **38** → **809 OK / 0 FALHA**.

## Sessão 23 — Etapa 4: D6=A2 (desbloqueio em desfecho verificado) + D8=A2 (escalonamento)

**Escopo autorizado:** implementar SOMENTE D6=A2 e D8=A2. Manter D1=A1, D2=A1, D3=A1, D4=A1, D5=A1 (já implementado), D7=A1 — **zero código novo**. **NÃO autorizado (e não feito):** débito/`DEBITO_CHARGEBACK`, `PERDA_PLATAFORMA`, saldo devedor, liberação parcial, `REEMBOLSO` automático, encerramento por timeout, alterar `payoutService.ts`, alterar migrações existentes, `.env` real, Sandbox real, secrets.

**Feito:**
1. **[INSPECT] Eventos de ganho** — mapeados na doc oficial (`docs.asaas.com/docs/payment-events`, 2026-10-20): após `AWAITING_CHARGEBACK_REVERSAL`, quando a plataforma vence, vem `PAYMENT_CONFIRMED` **ou** `PAYMENT_RECEIVED`. Adotado o conjunto **mais restritivo** (`CHARGEBACK_WON_EVENTS` = esses dois). Tabela evento→encerra em `findings.md` (Etapa 4).
2. **[IMPLEMENT D6=A2] `closeChargebackOnVerifiedOutcome`** em `asaasEventService.ts`: encerra (`ATIVO`→`ENCERRADO`) SOMENTE se (a) evento de ganho, (b) chargeback ATIVO correlacionado por `paymentId`, (c) status compatível com ganho (`isVerifiedWonStatus`: `DONE`/`REVERSED`/`disputeStatus=ACCEPTED`). Grava `closedAt`+`closedReason`. Idempotente (reenvio = no-op). **NÃO** cria `REEMBOLSO`, **NÃO** reverte `LIBERADO`, **NÃO** toca `payoutBlockReason`. Chamada no webhook (`route.ts`) no ramo de pagamento aprovado.
3. **[IMPLEMENT D6=A2] Migração aditiva** `20261020180000_etapa4_chargeback_desfecho_verificado`: adiciona `closedAt`/`closedReason` (nulas). Migrações `20261020120000...`/`20261020150000...` **intactas**.
4. **[IMPLEMENT D8=A2] `chargebackEscalationService.escalateChargebacksNearDeadline`** + rota `POST /api/jobs/chargeback-escalation/run` (`checkJobsToken`; retorna `{ ok, vencendo, vencidos }`; log sem PII). **Somente leitura** (não encerra, não muda `state`). Schedule diário `0 5 * * *` no workflow.
5. **[TEST]** `.tools/test-chargeback.mjs` §10 (D6=A2: ganho→ENCERRADO + guarda permite repasse + 2x idempotente + negativos: sem chargeback, status IN_DISPUTE, `AWAITING` sozinho) e `.tools/test-jobs.mjs` §7 (D8=A2: 401/200, vencendo=1/vencidos=1, 2x idempotente, state permanece ATIVO).
6. **[DOC]** `.protocol/decisions/D1-D8.md` (8 decisões marcadas, com data e justificativa), `findings.md` (seção Etapa 4).

**Arquivos criados:** `src/services/chargebackEscalationService.ts`; `src/app/api/jobs/chargeback-escalation/run/route.ts`; `prisma/migrations/20261020180000_etapa4_chargeback_desfecho_verificado/migration.sql`.
**Arquivos alterados:** `src/services/asaasEventService.ts` (+D6=A2, aditivo); `src/app/api/webhooks/asaas/route.ts` (chamada do encerramento); `prisma/schema.prisma` (+`closedAt`/`closedReason` em `ChargebackEvent`); `.github/workflows/jobs.yml` (+schedule escalonamento); `.tools/{test-chargeback.mjs,test-jobs.mjs}`; `.protocol/{decisions/D1-D8.md,findings.md,progress.md,task_plan.md}`.
**NÃO alterados:** `payoutService.ts`, migrações existentes, qualquer service/política de D1/D2/D3/D4/D5/D7, `.env` real.

**Estado da bateria (executada, não declarada):** `tsc --noEmit` exit **0**; `npm run build` exit **0**; `.tools/run-all-tests.ps1` → **`### TUDO OK`** (10/10 passos, 0 falha). Totais observados: Fase 1a **15** + 1b **8** + 1c **12** + Fase 2 **112** + Fase 3 **103** + Fase 4 **202** + Fase 5 **145** = **597**; Etapa 1+2 **92**; Etapa 3 **99**; Etapa 3.2 (jobs) **45** → **833 OK / 0 FALHA**. (Etapa 3: 82→99, +17; jobs: 38→45, +7.)
**Testes novos D6=A2 (observados em `.tools/test-chargeback.ps1`, §10):** ganho+chargeback ATIVO(status `DONE`)→`ENCERRADO` com `closedAt`/`closedReason`; guarda transacional PERMITE repasse após encerrar (HTTP 200); `hasActiveChargeback` fica FALSE; repetir evento de ganho não altera (1/1); **negativos:** evento de ganho SEM chargeback correlacionado = **no-op** (0→0, não cria registro); chargeback ATIVO em `IN_DISPUTE` **não** encerra; `AWAITING_CHARGEBACK_REVERSAL` sozinho **não** encerra; encerrar **não** cria `REEMBOLSO`.
**Testes novos D8=A2 (observados em `.tools/test-jobs.ps1`, §7):** 401 sem token, 200 com token; 1 vencendo em 2 dias + 1 vencido há 1 dia → `vencendo=1, vencidos=1`; 2ª execução com mesmo resultado; os 2 chargebacks permanecem `ATIVO` com `closedAt` nulo (não encerra).

## Próximos passos (ver também task_plan.md)

1. **Etapa 3 (pós-auditoria): webhook/chargeback — IMPLEMENTADO E TESTADO (mock) — VALIDAÇÃO SANDBOX PENDENTE.** Autenticação por cabeçalho, durabilidade/idempotência por `event.id`, bloqueio transacional de repasse, ramos de chargeback, disputa endurecida e rotas admin. **P1–P5 RESOLVIDOS por doc oficial (Etapa 3.1, 2026-10-20)** — ver `findings.md`. **Decisões humanas D1–D8 pendentes** (só proteções independentes implementadas). Chargeback real **não observado**: a doc confirma que o Sandbox exige **solicitação por e-mail** (`integracoes@asaas.com.br`) — validação **PENDENTE** até isso ser feito (não simular confirmação real). **Não autoriza produção.**
2. **Etapa 2 (pós-auditoria): VALIDADA no Sandbox — REVISÃO PENDENTE.** Automação (`sandbox-exec4.log` → `SANDBOX_EXIT=0`, 37 OK/0 FALHA, 2026-10-19) + `--keep-charges` (37 OK/0 FALHA) + **transição financeira real comprovada para DUAS contratações**: `--verify cmveqi5n80003t5drjb1f4gyu` (Sessão 13) e `--verify cmveqicd10007t5dr1w3vmvp6` (Sessão 14) → **exit 0, 12 OK/0 FALHA** cada: contratação **`RETIDO`**, chat **`ABERTO`**, exatamente 1 `RETENCAO` = bruto `80000`, idempotência em reentrega e evento tardio, histórico preservado (`RETENCAO 13→14→15`). Credencial `$aact_hmlg_` autenticada; `customer` criado 1× e reutilizado (`cus_000009561631`); QR Pix válido; exclusão fantasma tratada (listagem como autoridade). A cobrança antes citada aqui, `pay_djewxnmap7wo669x`, foi **excluída na limpeza do cenário 8** (`deleted=true`) e pertence ao hiring `cmvemrcbb0003fnf8a7xgn7wa` (não ao hiring antes suposto). **Boost `pay_emsiz6eibte8ysgc` (`cmveqiedg000tfenkjm6nnqsb`) VALIDADO na Sessão 15** via `--verify-boost` (exit 0, 20 OK/0 FALHA): `PAGO` + `urgentBoost=true` + zero ledger + sem chat/contratação — a lacuna do verificador de boost está fechada. Outras pendências manuais: reembolso/estorno pós-confirmação; transferência Pix (só se o Sandbox realizar).
2. Fase 5 (continuação): persistência do relatório de reconciliação, painel de **métricas** e
   **configurações financeiras editáveis** (comissão/taxa/boost). O painel operacional (disputas,
   denúncias, identidade, consultas, reconciliação ao vivo e lote de repasses) está pronto em `/admin`.
3. Habilitar o Asaas em produção: `ASAAS_API_URL=https://api.asaas.com/v3`, chave real, testar UMA transferência Pix de baixo valor e só então liberar o lote semanal (passos em `findings.md`)
4. Confirmar com o produto o valor da taxa do saque instantâneo (hoje 100 bps = 1%) e, na Fase 5, torná-la editável junto da comissão e do preço do boost
5. Apontar um agendador real (GitHub Actions cron — **Opção A escolhida na Etapa 3.2**; Vercel Cron só quando houver deploy Vercel) para as rotas `POST /api/jobs/*/run` com `x-jobs-token` = `secrets.JOBS_RUN_TOKEN`: `/api/jobs/opening-codes/run` + `/api/jobs/closing-codes/run` (a cada poucos minutos), `/api/jobs/weekly-payout/run` (semanal), `/api/jobs/daily-reconciliation/run` (diária) e `/api/jobs/chargeback-escalation/run` (diária, D8=A2). As rotas antigas `POST /api/cron/*` (protegidas por `x-internal-secret`) continuam existindo e não foram alteradas — ver `findings.md` > "Agendamento de jobs".

## Sessão 24 — Etapa 5: INSPECT do fluxograma × código (mapa e lacunas)

**Escopo autorizado:** **somente leitura + documentação**. Cruza CADA nó do `Freelaz — Fluxograma.html` com o que existe no código e lista, por nó, o que falta e as **perguntas** de produto pendentes. **NÃO autorizado (e não feito):** escrever qualquer código de produção (`src/`, `prisma/`, `.tools/*.mjs|*.ps1`), criar migração, decidir produto (só listar perguntas), tocar em `payoutService.ts`/`asaasEventService.ts`/`chargebackEscalationService.ts`/`jobsStartup.ts`, alterar migrações existentes, alterar `.env`, chamar Sandbox real, criar secrets.

**Feito:**
1. **[INSPECT] Schema Prisma** — inventário por área (cadastro/vaga/candidatura/contraproposta/contratação/chat/códigos/cancelamento/avaliação/financeiro/admin/notificações) com os modelos/enums reais e marcação `AUSENTE` onde não há. **Achados-chave:** **sem** model de **notificação**; **sem** model de **Configurações Financeiras** (comissão fixa em `lib/commission.ts` = 1000 bps; boost fixo = 1000 cents); **sem** modalidade (freelance/CLT/prestadora) na vaga; **sem** categoria como tabela (é `String[]`); `CltPlan` existe mas não ligado a vaga.
2. **[INSPECT] Services** — 18 services em `src/services/` mapeados (arquivo + funções + 1 linha). **AUSENTES:** notificação, config admin, service próprio de boost/categorias.
3. **[INSPECT] Rotas API** — 64 rotas `route.ts` mapeadas por área. **AUSENTES:** notificação, chat em tempo real, config financeira admin, categorias.
4. **[INSPECT] Testes** — 10 arquivos de teste em `.tools/` mapeados por seção. **AUSENTE:** teste HTTP dedicado de chat/avaliação/notificação/config admin.
5. **[DOC] Tabela mestre do fluxograma** — seção nova **"Mapa do fluxograma × código (Etapa 5)"** em `findings.md`, com 1 linha por nó (A→AD3 + WhatsApp): `Nó | Descrição | Schema | Service | Rota | Teste | Status | Lacuna | Decisão de produto pendente`. Status ∈ {IMPLEMENTADO, PARCIAL, AUSENTE, N/A}, sempre com evidência. `IMPLEMENTADO` só com as 4 evidências; faltando uma → `PARCIAL`. Ambiguidade registrada explicitamente (ex.: `CltPlan` existe mas sem uso → PARCIAL).
6. **[DOC] Decisões de produto pendentes** — seção consolidada em `findings.md`, **27 perguntas** agrupadas por área e **ordenadas por dependência** (frontend/protótipo, modalidade, notificação e config financeira primeiro). **Nenhuma resposta.**
7. **[DOC] Ordem sugerida (Etapa 6+)** — 7 itens com justificativa, e mapa de "área ← decisões que a bloqueiam".
8. **[TEST] Checks estáticos** — `npx tsc --noEmit` exit **0**; `npm run build` exit **0** (dev server parado antes por EPERM). **Bateria completa não rodada** — nenhuma mudança de código (por critério da tarefa).
9. **[COMMIT]** `docs: mapa do fluxograma × código (Etapa 5 — INSPECT)` — diff **só** em `.protocol/`.

**Arquivos alterados:** `.protocol/findings.md` (seção Etapa 5), `.protocol/progress.md` (esta sessão), `.protocol/task_plan.md` (Etapa 5).
**Não alterados:** qualquer arquivo em `src/`, `prisma/`, `.tools/*.mjs|*.ps1`, `.env`, migrações existentes.

**Estado dos checks (executados, não declarados):** `tsc --noEmit` exit **0**; `npm run build` exit **0**. Nenhuma linha de código de produção escrita.

## Sessao 25 - Etapa 6 - Fase A: cobertura HTTP de chat + avaliacao

**Escopo autorizado:** adicionar testes de integracao HTTP ponta a ponta para as duas areas que existem no codigo mas nao tinham cobertura HTTP dedicada - **chat** e **avaliacao**. **Nenhuma feature nova. Nenhuma decisao de produto.** Alteracoes restritas a `.tools/` e `.protocol/`.

**Feito:**
1. **[INSPECT]** - secao nova **"4b. Comportamento real de chat e avaliacao"** em `findings.md`: 1 paragrafo por area ancorado em arquivo/linha (`chatService.ts`, `chat/route.ts`, `chat/messages/route.ts`, `evaluationService.ts`, `evaluations/route.ts`, `profile/professional/route.ts`). Achados: `readAt` nunca e escrito (nao existe rota de "marcar como lida"); `senderId` do corpo e ignorado (autor sempre da sessao); chat so aceita POST com `ABERTO` (senao 409); `POST /evaluations` mapeia TODO erro do servico para **400**; `ratingAverage` e exposto em `GET /api/profile/professional`.
2. **[TEST-CHAT]** - `.tools/test-chat.mjs` + `.tools/test-chat.ps1` (7 secoes). Sobe dev server apontando para o mock do Asaas (porta 4011) com `PAYOUT_SANDBOX=1`; restaura ao final. **61 OK / 0 FALHA.**
3. **[TEST-AVAL]** - `.tools/test-evaluation.mjs` + `.tools/test-evaluation.ps1` (8 secoes). Mock na porta 4012. **48 OK / 0 FALHA.**
4. **[TEST]** - `run-all-tests.ps1` agora roda **11/12 = test-chat** e **12/12 = test-evaluation** (passos 1-10 renumerados para /12). Exit code encadeado mantido.
5. **[DOC]** - `findings.md`: linhas **P4** e **AV1** promovidas de `PARCIAL` para **IMPLEMENTADO** (com as 4 evidencias: schema+service+rota+teste), com as limitacoes de produto explicitas (`readAt` nunca marcado / sem avaliacao cega / sem rota de leitura). Inventario de testes atualizado; secao nova **"4c. Resultado dos testes"**; ordem sugerida (Etapa 6+) ajustada.
6. **[TEST]** - `npx tsc --noEmit`, `npm run build`, `.tools/run-all-tests.ps1` (detalhe abaixo).

**Bugs encontrados:** nenhum. Todo o comportamento observado coincide com o mapa; as lacunas remanescentes sao limitacoes de produto ja registradas (nao sao bugs).

**Arquivos criados:** `.tools/test-chat.mjs`, `.tools/test-chat.ps1`, `.tools/test-evaluation.mjs`, `.tools/test-evaluation.ps1`.
**Arquivos alterados:** `.tools/run-all-tests.ps1` (11/12 + 12/12), `.protocol/{findings.md,progress.md,task_plan.md}`.
**NAO alterados:** qualquer arquivo em `src/` ou `prisma/`; `payoutService.ts`, `asaasEventService.ts`, `chargebackEscalationService.ts`, `jobsStartup.ts`; migracoes existentes; `.env` real.

**Procedimento de .env:** a `.env` tinha `ASAAS_API_KEY` preenchida; foi esvaziada SOMENTE para a bateria local (guard 503), com backup em `%TEMP%\freelaz-env-backup-etapa6a.env` e **restaurada ao final**.
## Sessao 26 - Etapa 7 (7.1 + 7.3a + 7.3b + 7.3c + 7.3c.1): chat soft-hide, subcontas Asaas e semantica do split

**Escopo autorizado:** fechar a Etapa 7.1 (soft-hide do chat), criar a fundacao de subcontas (7.3a), o onboarding (7.3b), o split na cobranca (7.3c) e, nesta rodada, a 7.3c.1: conferir na doc oficial a semantica do split, corrigir PJ (`companyType`/`tradeName`), adicionar guard de valores invalidos e deixar o scaffold puro do payout via subconta (7.3d). **NAO autorizado (e nao feito):** mover dinheiro, chamar Asaas real/Sandbox, ligar feature flags por padrao, alterar migracoes existentes, logar `walletId`/`apiKey`/`incomeValueCents`/`companyType`, ampliar escopo de produto.

**Feito (7.1) - soft-hide do chat:**
1. `Chat.hiddenAt DateTime?` + migracao aditiva `20261020210000_etapa7_chat_hide`; `chatService.hideConcludedChats()` oculta somente `Hiring.status=CONCLUIDO` com `completedAt <= now-2h` e `hiddenAt IS NULL`, exceto disputa aberta (`Hiring.disputeOpen` / `Dispute.EM_ANALISE`) ou chargeback ATIVO. Nunca deleta chat/mensagem.
2. Job `POST /api/jobs/hide-concluded-chats/run` (`checkJobsToken`, schedule `*/15`); `getChatForUser` devolve 404 quando oculto; `getChatForAdmin` sempre devolve; `PATCH /api/hirings/[id]/chat/messages/read` marca `readAt`; `GET /api/admin/hirings/[id]/chat`.
3. `test-chat.mjs` §8-§11: +19 asserts (readAt, soft-hide, disputa, chargeback). `test-chat` passou a **80 OK / 0 FALHA**.

**Feito (7.3a) - fundacao subcontas:**
- `User.asaasSubaccountId` / `asaasSubaccountApiKey` / `asaasSubaccountStatus`; migracao `20261021150000_etapa73a_subcontas`.
- `createAsaasSubaccount` / `getAsaasSubaccount` / `getAsaasSubaccountBalance` + tipos em `lib/asaas.ts`; flag `ASAAS_SUBACCOUNT_ENABLED="false"`. Nenhum fluxo ligado.

**Feito (7.3b) - onboarding (mock):**
- `User.postalCode`/`address`/`addressNumber`/`province`/`incomeValueCents`; migracao `20261022120000_etapa73b_endereco_subconta`; `PUT /api/profile/professional` valida os 5 campos.
- `subaccountService.createSubaccountForUser` idempotente (id existente -> `skipped`), payload PF/PJ, erros 4xx -> `{ok:false}` e 5xx/rede relancam; `POST /api/profile/subaccount` (401/403/503/400/200). Mock `POST/GET /v3/accounts` (apiKey so no POST).
- `test-subaccount.mjs` com 54 asserts; bateria **1085 OK / 0 FALHA**.

**Feito (7.3c) - split:**
- `User.asaasSubaccountWalletId`, `Hiring.asaasSplitId`, `Payout.origin` (`MAIN`/`SUBACCOUNT`); migracao `20261023120000_etapa73c_split`.
- `chargeService.ensureCharge` inclui split apenas para HIRING, com flag ON + subconta + walletId; senao payload sem split e `asaasSplitId=null`. Webhook apenas loga o split; nao move dinheiro. Mock valida wallet/percentual. 67 asserts; bateria **1098 OK / 0 FALHA**.

**Feito (7.3c.1) - semantica + PJ + scaffold payout:**
1. **Split (doc oficial):** uma unica entrada `[{walletId: subconta, percentualValue: 90}]` e valida; o restante permanece na conta principal e o wallet da principal **nao** e enviado (proibido pela doc). Mock passou a rejeitar soma **> 100%** (nao `!= 100`).
2. **`incomeValue`:** confirmado em **reais** (`incomeValueCents / 100`), nao centavos.
3. **PJ:** `User.companyType String?` + migracao aditiva **15** (`20261023130000_etapa73c1_company_type`); enviado somente para CNPJ e validado contra `MEI|LIMITED|INDIVIDUAL|ASSOCIATION`. **`tradeName` nao existe no request** de `POST /v3/accounts` (a resposta traz `tradingName` automatico), entao a exigencia local foi removida; `name` segue como razao social.
4. **Guard:** `resolveHiringSplit` devolve `reason=invalid_values` (split OFF) quando `grossValueCents <= 0`, `netValueCents <= 0` ou `netValueCents > grossValueCents`.
5. **Scaffold 7.3d:** `payoutService.resolvePayoutOrigin(hiring)` puro, **nao chamado no fluxo**: flag `PAYOUT_FROM_SUBACCOUNT_ENABLED=false` -> `MAIN`; ON sem apiKey -> `MAIN`; ON + apiKey -> `SUBACCOUNT`. Nao grava `Payout.origin` nem move dinheiro.
6. **Testes:** `test-subaccount.mjs` §7b (guard `net>gross`) e §9 (`resolvePayoutOrigin`, 3 casos) -> **14 OFF + 59 ON = 73 asserts / 0 falhas**. `tsc --noEmit` exit 0; `prisma generate` e `prisma migrate deploy` OK (15 migracoes).
7. **Docs:** `findings.md` 4h atualizado e secao **4i** com fontes e conclusoes.

**Bateria completa (executada, nao declarada):** `.tools/run-all-tests.ps1` 14/14 passos -> **`BATTERY_EXIT=0`**, **1104 OK / 0 FALHA**:
Fase 1a 15 + 1b 8 + 1c 12 + Fase 2 112 + Fase 3 103 + Fase 4 202 + Fase 5 145 (=597); Etapa 1+2 92; Etapa 3 99; Etapa 3.2 jobs 45; chat 80; avaliacao 48; notificacoes 70; subconta 14 OFF + 59 ON = 73. Contagem anterior 1098; +6 desta etapa.

**Correcao de harness:** o wrapper da bateria usava `*>` (pipe); o dev server iniciado nos passos herdava o handle e a bateria travava no passo 10 mesmo com os testes ja concluidos. Passou a usar redirecionamento direto em arquivo (`cmd /c "... > log 2>&1"`) com exit gravado imediatamente em arquivo-marcador.

**Arquivos criados (7.3c.1):** `prisma/migrations/20261023130000_etapa73c1_company_type/migration.sql`.
**Arquivos alterados (7.3c.1):** `prisma/schema.prisma` (+`User.companyType`); `src/services/subaccountService.ts`; `src/services/chargeService.ts`; `src/services/payoutService.ts`; `.tools/mock-asaas.mjs`; `.tools/test-subaccount.mjs`; `.env.example`; `.protocol/{findings.md,progress.md}`.
**Nao alterados:** migracoes 1-14, `asaasEventService.ts`, rotas de jobs, qualquer fluxo que mova dinheiro, `.env` real (chave esvaziada so para a bateria e restaurada depois; valor nunca logado).

**Bloqueios/pendencias (inalterados):** Sandbox da conta principal e CPF (subconta exige conta-pai CNPJ) -> criacao real so no mock; chargeback real pendente de solicitacao ao Asaas; agendador real (`JOBS_URL`/deploy) nao apontado; paginacao multi-pagina (>100) nao exercitada (fail-closed 503); frontend bloqueado pelo prototipo; 27 decisoes de produto pendentes em `findings.md`.

---

## Sessao 27 - Etapa 7.3d: modelo de taxa "empresa paga tudo" (custodia, sem subcontas)

**Objetivo:** profissional recebe 100% (`netValue = gross`); a empresa paga
`gross + serviceFee (10%) + estimatedWithdrawalFee` no checkout. Modelo novo
(`NEW`) atras de `TAX_MODEL_NEW=false`; historico (`LEGACY`) intocado.

**Feito:**
1. **Schema (migracao 16, aditiva):** `Hiring.taxModel String @default("LEGACY")`, `serviceFeeCents Int?`, `estimatedWithdrawalFeeCents Int?`, `totalChargedCents Int?`; `LedgerEntryType.RECEITA_PLATAFORMA`. Migracao `20261023140000_etapa73d_tax_model` + backfill `LEGACY`.
2. **`commission.ts`:** `estimateWithdrawalFeeCents(gross)` -> `<= 25000` = 8; senao 200. `PLATFORM_COMMISSION_BPS=1000` mantido.
3. **`hiringService.createHiringForApplication`:** branch NEW/LEGACY; em NEW `serviceFee=round(gross*0.10)`, `estimated=estimate(gross)`, `total=gross+fee+est`, `net=gross`; log `[hiring] taxModel=NEW gross=.. fee=.. withdrawal=.. total=..` (sem PII).
4. **`chargeService.ensureCharge`:** HIRING NEW cobra `totalChargedCents`; LEGACY cobra o bruto. **Sem split** (subcontas off).
5. **`ledgerService`:** `recordPlatformRevenue` + `RECEITA_PLATAFORMA`; webhook `PAYMENT_CONFIRMED` em NEW cria 2 lancamentos (`RETENCAO=gross`, `RECEITA_PLATAFORMA=taxas`); LEGACY continua 1. `computeRetainedBalance` ignora a receita.
6. **`payoutService.releasePayout`:** base = bruto em NEW, liquido em LEGACY; `amountCents = base - fee` (saque manual desconta a taxa do profissional); log `[payout] taxModel=NEW ... withdrawalFeeReal=..`.
7. **`walletService.disponivelCents`:** NEW = bruto; LEGACY = liquido. `POST /wallet/withdraw` inalterado.
8. **`webhook`:** valor esperado = `totalChargedCents` em NEW (evita falso `valor_divergente`).
9. **`.env.example`:** `TAX_MODEL_NEW="false"`.
10. **Docs:** `findings.md` secao **4j** (tabela, decisao, nota regulatoria Resolucao BCB 518/2025 + prazo 2027).
11. **Testes:** `.tools/test-taxmodel.mjs` + `.ps1` (fases OFF/ON) integrados como passo 15/15; nenhum teste existente alterado.

**Nao feito / proibido mantido:** subcontas e split NAO ativados (flags OFF); migracoes 1-15 intocadas; nenhum dado historico alterado; nenhum dinheiro movido.

**Arquivos criados:** `prisma/migrations/20261023140000_etapa73d_tax_model/migration.sql`, `.tools/test-taxmodel.mjs`, `.tools/test-taxmodel.ps1`.
**Arquivos alterados:** `prisma/schema.prisma`; `src/lib/commission.ts`; `src/services/hiringService.ts`; `src/services/chargeService.ts`; `src/services/ledgerService.ts`; `src/services/payoutService.ts`; `src/services/walletService.ts`; `src/app/api/webhooks/asaas/route.ts`; `.env.example`; `.tools/run-all-tests.ps1`; `.protocol/{findings.md,progress.md}`.

---

## Sessao 28 - Frontend Fase 1: 7 telas + tab bar (integracao real)

**Objetivo:** entregar o MVP navegavel no mesmo app Next.js 14 (App Router),
mobile-first (max 430px), consumindo apenas endpoints existentes.

**Feito:**
1. **Spec:** `.protocol/frontend-spec.md` (paleta, tipografia, componentes,
   descricao textual das imagens de referencia, rotas, contratos, estados).
2. **Design system minimo:** `globals.css` (tokens), Poppins via
   `next/font/google`, `Card`, `Chip`, `Button`, `Badge`, `ScreenHeader`,
   `BottomTabBar`, `AuthShell` + `Icons` (SVG inline). CSS Modules (sem Tailwind).
3. **Rotas:** `(web)` com guard de sessao (`/api/auth/me` -> `/login`) + header
   + tab bar; `login` e `cadastro` fora do grupo (sem tab bar). O `page.tsx`
   raiz antigo foi removido (conflitava com `(web)/page.tsx`).
4. **Telas:** Home (busca + chips + filtros + destaques + recentes), Vaga
   (`/vaga/[id]`), Perfil, Carteira, Mensagens, Login, Cadastro.
5. **Buscar:** `/buscar` -> `redirect('/?focus=search')`; a Home foca o campo e
   a tab Buscar fica ativa (`useSearchParams` no tab bar, dentro de Suspense).
6. **Integracao real:** `/api/jobs`, `/api/jobs/[id]`, `/api/profile/professional`,
   `/api/wallet`, `/api/hirings`, `/api/auth/{me,login,register,logout}`.
   Nenhum endpoint alterado; nenhum dado mock.
7. **Honestidade de UI:** controles de Fase 2 desabilitados com nota (sino,
   favoritar, enviar proposta, editar perfil, depositar/sacar/transferir/
   historico, abrir conversa); sem grafico de ganhos; sem requisitos inventados.
8. **Verificacao:** `npx tsc --noEmit` exit 0; `npm run build` exit 0 (58 rotas
   geradas). Teste manual no browser com o dev server: login/cadastro (sucesso,
   validacao client e erro 409), guard sem sessao, Home com 50 de 51 vagas,
   filtro por chip (Seguranca = 1), busca textual (2 de 51), vaga por ID com
   dados reais, perfil (maria, 65% de forca), carteira (ana, 2 lancamentos),
   mensagens (ana, 1 chat ABERTO), tab bar com 5 itens e Buscar focando o campo.
9. **Limitacao tratada:** a lista da Home cortava em 20 itens mas o contador
   dizia "50 de 51"; o corte de 20 foi removido para o contador refletir a lista.

**Arquivos criados:** `src/app/globals.css`; `src/app/(web)/**`;
`src/app/login/page.tsx`; `src/app/cadastro/page.tsx`; `src/components/**`
(inclui `screens/**`); `src/lib/{apiClient,apiTypes,format}.ts`;
`.protocol/frontend-spec.md`.
**Alterados:** `src/app/layout.tsx`; `.protocol/{progress,findings}.md`.
**Removido:** `src/app/page.tsx` (substituido por `(web)/page.tsx`).
**Nao alterados:** endpoints, schema, migracoes, `src/app/admin/page.tsx`.

**Pendencias (Fase 2):** candidatura, checkout, codigo de turno, avaliacao,
publicar vaga, notificacoes, abrir/enviar conversa, saque/deposito/transferencia,
edicao de perfil, paginacao real (>50) e contador de nao lidas.

---

## Sessao 29 - Fase 1.1: identidade visual final (Montserrat + cores)

**Motivo:** a Fase 1 usou a spec antiga (Poppins, `#0B1F3B`, `#F2F4F7`); a
identidade final e Montserrat, `#0B1F44` e `#E8EEF7`.

**Feito (somente CSS/fonte):**
1. `src/app/layout.tsx`: `Poppins` -> `Montserrat` (400/500/600/700/800), variavel
   `--font-montserrat`.
2. `src/app/globals.css`: tokens de marca `--azul-principal` (#0066FF),
   `--azul-escuro` (#0B1F44), `--cinza-claro` (#E8EEF7) e
   `--font-family: 'Montserrat', sans-serif`. Os nomes antigos (`--primary`,
   `--title`, `--bg`) viraram aliases para nao reescrever as telas.
3. `.protocol/frontend-spec.md`: paleta e tipografia atualizadas.

**Nao alterados:** logica, endpoints, componentes/telas, schema, migracoes.

**Observacao:** os gradientes decorativos de `HomeScreen`/`JobDetailScreen`
ainda usam o hex antigo `#0B1F3B` dentro do TSX; como a tarefa proibia mexer em
componentes, foi mantido (diferenca visual imperceptivel).
