# Freelaz — Backend (API)

Protocolo de setup e teste local, sem precisar pagar por nenhuma ferramenta.

---

## 0. O que você precisa instalar (tudo gratuito)

- [Node.js](https://nodejs.org/) — versão 20 (LTS)
- [VS Code](https://code.visualstudio.com/) — ou qualquer editor
- Extensão **Thunder Client** no VS Code (ou [Insomnia](https://insomnia.rest/download)/[Postman](https://www.postman.com/downloads/))
- [ngrok](https://ngrok.com/download) — só vai ser necessário na Parte 3 (webhook)

---

## 1. Banco de dados (Neon.tech, grátis)

1. Crie conta em [neon.tech](https://neon.tech) (tem plano gratuito, não pede cartão)
2. Crie um projeto novo, chamado `freelaz`
3. Copie a **Connection string** (algo como `postgresql://usuario:senha@ep-xxxx.neon.tech/freelaz?sslmode=require`)

> **Alternativa local:** se você já tem PostgreSQL instalado na máquina, crie um banco
> `freelaz` e use `DATABASE_URL="postgresql://postgres:SUA_SENHA@localhost:5432/freelaz"`
> (sem `?sslmode=require` no local). O resto do passo a passo é igual.

Com `psql` ou pelo pgAdmin, crie o banco vazio:

```sql
CREATE DATABASE freelaz;
```

## 2. Asaas em modo teste (grátis)

O pagamento do Freelaz roda sobre o **Asaas** (migração decidida sobre o Mercado Pago — ver
`.protocol/findings.md`).

1. Crie conta em [sandbox.asaas.com](https://sandbox.asaas.com) (conta de teste, sem CNPJ)
2. No painel sandbox, vá em **API** → **Adicionar chave** e copie a chave (começa com `$aact_`)
3. Gere também um **token de webhook** em **API → Webhook** (qualquer texto longo serve em dev;
   o backend compara o campo `token` dos avisos do Asaas com `ASAAS_WEBHOOK_TOKEN`)

## 3. Configurar o projeto

```bash
# dentro da pasta freelaz-backend
cp .env.example .env
```

Abra o `.env` e preencha:
- `DATABASE_URL` → a connection string do Neon
- `ASAAS_API_KEY` → a chave do sandbox (`$aact_...`). **Deixe vazia para só testar a API sem
  cobrança real**: sem chave, `payments/create` e `jobs/boost` respondem `503` e o webhook
  confia no payload já autenticado pelo token (modo dev). Com chave, o backend rebusca o
  pagamento na API do Asaas antes de agir.
- `ASAAS_WEBHOOK_TOKEN` → o token de webhook definido no painel (compare com timing-safe)
- `ASAAS_API_URL` → deixe como está (`https://sandbox.asaas.com/api/v3`); produção usa
  `https://api.asaas.com/v3`

> Não existe mais `APP_URL` no `.env` — ele só existia para o checkout do Mercado Pago. A URL do
> webhook hoje é cadastrada **no painel do Asaas**, não no backend.

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

Se o `prisma:migrate` rodar sem erro, seu banco já está criado com todas as tabelas (`User`, `JobPosting`, `Hiring`, etc.).

## 4. Subir o servidor

```bash
npm run dev
```

Abra `http://localhost:3000` no navegador — se aparecer "Freelaz — backend rodando ✅", está tudo certo até aqui.

## 5. Testar uma rota simples (sem precisar do Asaas ainda)

Use o Thunder Client (ou Insomnia/Postman) pra mandar essa requisição:

```
POST http://localhost:3000/api/jobs/[id]/select
Content-Type: application/json

{
  "applicationId": "algum-id-de-teste"
}
```

Esperado: como ainda não existe nenhum dado no banco, a resposta deve ser um erro `422` dizendo "Candidatura não encontrada" — **isso é bom sinal**, significa que a rota está rodando e validando corretamente, só falta ter dado real pra testar com sucesso. Pra testar o caminho feliz, você vai precisar inserir alguns registros de teste no banco primeiro (veja a Parte 7).

## 6. Testar o pagamento de verdade (precisa do ngrok, por causa do webhook)

O Asaas precisa mandar uma notificação pra uma URL pública quando o pagamento muda de status —
`localhost` não é alcançável de fora, por isso:

```bash
ngrok http 3000
```

Isso te dá uma URL tipo `https://abcd1234.ngrok-free.app`. Copie ela e:
1. Cadastre essa URL (+ `/api/webhooks/asaas`) como notificação no painel sandbox do Asaas, com o mesmo token de `ASAAS_WEBHOOK_TOKEN`
2. Não precisa mudar nada no `.env` — o backend não conhece a URL pública; quem dispara o webhook é o Asaas.

Aviso sobre a **assinatura do webhook**: o Asaas não assina HMAC — a autenticação é o campo
`token` no corpo da notificação, comparado com `ASAAS_WEBHOOK_TOKEN` (comparação à prova de
tempo). Por isso **dá para testar o webhook sem ngrok também**: mande a notificação direto no
`Thunder Client` para `POST http://localhost:3000/api/webhooks/asaas` com o corpo que o Asaas
enviaria (veja exemplos nos testes da Fase 4, `.tools/test-fase4.ps1`).

Agora teste criar um pagamento:

```
POST http://localhost:3000/api/payments/create
Content-Type: application/json

{ "hiringId": "id-de-uma-contratacao-real-no-banco" }
```

Sem `ASAAS_API_KEY` a resposta é `503` (comportamento esperado — nada de sucesso simulado).
Com a chave do sandbox, a resposta traz a cobrança Pix e o QR Code; o pagamento (Pix de teste
do sandbox) dispara o webhook e a contratação vai para `RETIDO` com a retenção no ledger.

## 7. Inserir dados de teste no banco (sem escrever SQL na mão)

```bash
npm run prisma:studio
```

Isso abre uma interface visual no navegador (`localhost:5555`) onde você consegue criar manualmente um `User`, um `JobPosting`, uma `Application`, etc., clicando — sem precisar escrever nenhum comando SQL. Use isso pra montar um cenário de teste completo (uma empresa, um profissional, uma vaga) antes de testar o fluxo de ponta a ponta.

---

## Rotas disponíveis até agora

### Fundação (Fase 1) — cadastro, sessão, papéis, perfil e verificação

| Rota | O que faz |
|---|---|
| `POST /api/auth/register` | Cadastro único (CPF/CNPJ) + papéis + aceite dos Termos |
| `POST /api/auth/login` | Login (e-mail + senha); grava o cookie de sessão |
| `POST /api/auth/logout` | Encerra a sessão atual |
| `GET /api/auth/me` | Estado da sessão: usuário, papéis (status), perfis |
| `POST /api/auth/roles` | Ativa um papel depois do cadastro (Profissional/Contratante) |
| `GET /api/auth/roles` | Lista os papéis da conta com status |
| `POST /api/auth/confirm` | Confirma o e-mail com o token recebido |
| `POST /api/auth/password/forgot` | Pede token de redefinição (sai no console em dev) |
| `POST /api/auth/password/reset` | Troca a senha com o token de uso único |
| `GET/PUT /api/profile/professional` | Lê/edita o perfil do Profissional (bio, categorias, portfólio, experiências, currículo) |
| `GET/PUT /api/profile/contractor` | Lê/edita os dados básicos do Contratante |
| `POST /api/verification/professional` | Envia documento + selfie (CPF) ou submete CNPJ para análise |
| `POST /api/verification/contractor` | Verificação leve do Contratante (exige e-mail confirmado) |
| `GET /api/uploads/<caminho>` | Serve os arquivos enviados (documento/selfie/currículo só do dono) |

### Marketplace (Fase 2) — vaga, candidatura, contratação e chat

| Rota | O que faz |
|---|---|
| `GET /api/jobs` | Marketplace público: só vagas PÚBLICAS, ABERTAS e no prazo. Filtros `q`, `category`, `city`, `state`, `date` (YYYY-MM-DD, fuso de Brasília), `minValueCents`, `maxValueCents`, `sort`, `page`, `limit` |
| `POST /api/jobs` | Publica uma vaga pública (exige papel Contratante ATIVO) |
| `GET /api/jobs/[id]` | Detalhe público da vaga (vaga PRIVADA só o dono e o alvo enxergam) |
| `PATCH /api/jobs/[id]` | Edita uma vaga ABERTA sem contratação viva (só a empresa dona) |
| `DELETE /api/jobs/[id]` | Cancela a vaga (soft delete; nunca apaga o histórico) |
| `POST /api/jobs/[id]/apply` | Candidata-se a uma vaga pública (exige papel Profissional ATIVO) |
| `GET /api/jobs/[id]/applications` | Lista as candidaturas da vaga (só a empresa dona) |
| `GET /api/applications` | "Minhas candidaturas" (lado Profissional) |
| `POST /api/jobs/[id]/select` | Empresa seleciona um candidato — cria o `Hiring` em `AGUARDANDO_PAGAMENTO` |
| `GET/POST /api/jobs/[id]/resume` | Lista suplentes (já filtrando conflito de agenda) / retoma a vaga com um deles |
| `POST /api/jobs/invite` | Cria o convite direto ("Me contrate") como vaga PRIVADA |
| `POST /api/applications/[id]/counter-offer` | Envia uma contraproposta de valor (qualquer lado) |
| `POST /api/applications/[id]/respond` | Aceita ou recusa a proposta/candidatura |
| `GET /api/hirings` | "Minhas contratações" (empresa e profissional), com filtros `side`, `status`, `active` |
| `GET /api/hirings/[id]` | Detalhe da contratação (só as duas partes): valores, ledger, payout e chat |
| `GET /api/hirings/[id]/chat` | Histórico da conversa (cursor `before`, `limit`) |
| `POST /api/hirings/[id]/chat/messages` | Envia mensagem — só com o chat ABERTO (pagamento confirmado) |

O chat não tem estado próprio: ele é **derivado** do status da contratação (`AGUARDANDO_PAGAMENTO`
antes do pagamento, `ABERTO` em `RETIDO`/`EM_ANDAMENTO`/`CONCLUIDO`/`EM_DISPUTA`, `ENCERRADO` em
`CANCELADO`/`LIBERADO`).

### Dinheiro (Fase 3 — rotas prontas, telas pendentes do protótipo visual)

| Rota | O que faz |
|---|---|
| `POST /api/payments/create` | Cria a cobrança Pix de uma contratação (só a empresa dona). **Idempotente de verdade** (Etapa 1): reconcilia com o provedor por `externalReference` *antes* de criar (ausência só com listagem completa — `hasMore === false`), serializa a concorrência com trava no banco e registra cada tentativa em `ChargeAttempt` — nunca duas cobranças para a mesma operação. Resolve antes o **`customer` obrigatório** do provedor (cliente por usuário: criado na 1ª cobrança e reutilizado — recusa definitiva → 502, indisponibilidade → 503). Respostas: `200` (criada/adotada), `409` (concorrência), `502` (recusa do provedor), `503` (ambíguo / sem `ASAAS_API_KEY` / listagem incompleta) |
| `POST /api/webhooks/asaas` | Recebe as notificações do Asaas (autenticadas pelo campo `token` vs `ASAAS_WEBHOOK_TOKEN`, timing-safe). Com chave, rebusca o pagamento na API antes de agir |
| `POST /api/payouts/release` | Libera o repasse de uma contratação `CONCLUIDO` (rota interna, header `x-internal-secret`) |
| `GET /api/wallet` | Carteira + extrato do profissional (só papel Profissional ATIVO). Buckets: `aReceberCents`, `disponivelCents`, `emProcessamentoCents`, `sacadoCents` + `instantWithdrawalFeeBps`. A tela não existe ainda (falta o protótipo visual) |
| `POST /api/wallet/withdraw` | Saque instantâneo de uma contratação `CONCLUIDO` e ainda não repassada: aplica a taxa (`INSTANT_WITHDRAWAL_FEE_BPS`) e dispara o mesmo repasse (recusado antes da janela de 2h da Fase 4) |
| `POST /api/hirings/[id]/codes` | Só a empresa confirma o código do turno: `OPENING` (→ `EM_ANDAMENTO`) ou `CLOSING` (→ `CONCLUIDO`). Máx. 5 tentativas por tipo, com auditoria `CodeAttempt` |
| `POST /api/cron/shift-codes` | Agendador dos códigos: gera abertura/fechamento para turnos começando/terminando em ~1h |
| `POST /api/cron/payouts` | Repasse **semanal** em lote: libera todas as contratações `CONCLUIDO` ainda não repassadas (falha numa não impede as outras) |
| `POST /api/cron/reconciliation` | Reconciliação **diária**: checa as 5 invariantes do dinheiro e reporta as divergências |
| `POST /api/jobs/boost` | Cobra o impulsionamento "Publicar com urgência" (R$10) pelo **mesmo** serviço idempotente do `/api/payments/create` (reconciliação + trava + `ChargeAttempt`; no máximo 1 boost vivo por vaga) — **503 sem `ASAAS_API_KEY`** |

As rotas `/api/cron/*` e `/api/payouts/release` são internas: mande
`x-internal-secret: <INTERNAL_API_SECRET>` (em produção o segredo é obrigatório).

O dinheiro só sai por `releasePayout` (Payout + ledger + status `LIBERADO` na **mesma transação**),
e só depois da **janela de 2h** após o uso do código de fechamento e **sem disputa aberta** (gate
da Fase 4). Em desenvolvimento, com `PAYOUT_SANDBOX=1` no `.env`, o repasse usa um provedor de
sandbox que confirma a transferência sem mover dinheiro — **em produção `PAYOUT_SANDBOX` é
ignorado** e o provedor real chama a API `/transfers` do Asaas. Antes do primeiro lote em
produção: chave real + uma transferência Pix de baixo valor testada (ver `.protocol/findings.md`).

### Confiança (Fase 4 — avaliação, confiabilidade, check-in, disputas e denúncias)

| Rota | O que faz |
|---|---|
| `POST /api/evaluations` | Avaliação mútua (1-5 estrelas + comentário, uma por parte por contratação); só após a janela de 2h do código de fechamento |
| `GET /api/evaluations?hiringId=` | Avaliações de uma contratação (partes e admin) |
| `GET /api/hirings/[id]` | Detalhe agora inclui `evaluations`, `checkIn` e `disputes` da contratação |
| `POST /api/hirings/[id]/check-in` | Check-in do profissional no início do turno (geolocalização como evidência; não bloqueia o código de abertura) |
| `GET /api/hirings/[id]/check-in` | Evidência de check-in (partes) |
| `POST /api/hirings/[id]/cancel` | Cancelamento pelas duas partes — caminho único, reembolso de 100% via ledger |
| `POST /api/hirings/[id]/dispute` | Abre disputa (só após pagamento; uma por contratação) e move para `EM_DISPUTA` |
| `GET /api/hirings/[id]/dispute` | Disputa da contratação com evidências (partes) |
| `POST /api/hirings/[id]/dispute/evidence` | Anexa evidência (data URL de imagem/documento/texto) enquanto a disputa estiver em análise |
| `POST /api/reports` | Denúncia de comportamento (categoria `ABUSO` nasce prioritária; denúncia nunca move dinheiro) |
| `GET /api/reports` | Minhas denúncias (autor) / recebidas (admin com segredo) |
| `GET /api/admin/disputes?status=` | Fila de disputas (header `x-internal-secret`) |
| `POST /api/admin/disputes/[id]/resolve` | Decide: `DEVOLUCAO_TOTAL`, `LIBERACAO_TOTAL` ou `DIVISAO` (percentual do líquido ao profissional) — `adminId` auditado |
| `GET /api/admin/reports?status=` | Fila de denúncias (ALTA primeiro) |
| `POST /api/admin/reports/[id]/resolve` | Fecha a denúncia com desfecho (`ACAO_TOMADA`/`ARQUIVADA`) e nota — `adminId` auditado |

### Administração (Fase 5 — painel admin mínimo em `/admin`)

O painel é uma UI web mínima (uma página client-side, sem biblioteca nova) que opera
as funções que já existiam nas rotas: **análise de disputas e denúncias, aprovação
manual de identidade, consultas financeiras, reconciliação e disparo do lote de
repasses**. Ele não cria regra de negócio nova — cada botão chama uma rota que já
existia ou que compartilha o mesmo serviço (ex.: o lote do painel chama
`processPendingPayouts()`, a mesma função do cron semanal).

Autorização das rotas `/api/admin/*`: **segredo interno** (`x-internal-secret`, como
antes — usado por infra/testes) **ou sessão de conta com papel `ADMIN` ativo**. Quando
a decisão vem da sessão do painel, o `adminId` auditado é o **id do usuário logado**
(não um campo do corpo). O papel `ADMIN` é atribuído **à mão** pelo operador (Prisma
Studio/script) e **não** é autoatribuível por nenhuma rota.

| Rota | O que faz |
|---|---|
| `GET /api/admin/verifications?status=` | Fila de verificação de identidade (default `EM_ANALISE`). Documento sempre **mascarado** na lista; os anexos (documento/selfie) são abertos por `/api/uploads/...`, que libera `verifications/` e `private/` para conta `ADMIN` |
| `POST /api/admin/verifications/[id]/approve` | Aprova a identidade numa transação: `IdentityVerification` → `VERIFICADO` + `decidedById` + `analyzedAt`, `UserRoleAssignment` → `ATIVO` e o `verificationStatus` do perfil → `VERIFICADO` (o mesmo que era feito à mão no Prisma Studio) |
| `POST /api/admin/verifications/[id]/reject` | Rejeita com **motivo obrigatório** (grava `rejectionReason` + `decidedById`), devolve para `NAO_VERIFICADO` — o usuário pode **reenviar** |
| `GET /api/admin/hirings?status=&take=` | Visão global de contratações (partes com documento mascarado, valores, payout e lançamentos) — só consulta |
| `GET /api/admin/payouts?status=&take=` | Repasses (transferências Pix de saída): status, valor, id no provedor e motivo de falha — só consulta |
| `POST /api/admin/payouts/run-batch` | Dispara o lote de repasses pelo painel — **mesmo serviço** do `/api/cron/payouts` (elegibilidade, idempotência e ledger intactos) |
| `GET /api/admin/ledger?hiringId=&take=` | Livro-razão auditado (todo lançamento + quem criou). Append-only: leitura pura; correção é um `AJUSTE` novo |
| `GET /api/admin/reconciliation` | Reconciliação **ao vivo** (as mesmas 5 invariantes do cron diário) + repasses com falha e lançamentos `AJUSTE`. Reporta, nunca corrige nem move dinheiro |

`GET /api/admin/disputes` e `GET /api/admin/reports` foram **enriquecidos** para a
análise: mostram as partes (documento mascarado), o lado que abriu a disputa e a
**autoria de cada evidência**. As decisões (`/resolve`) continuam registrando o
`adminId` auditado.

> **Nota:** a persistência do relatório de reconciliação (para consulta histórica) segue
> como trabalho futuro — hoje o painel consulta a reconciliação ao vivo a cada abertura,
> sem guardar histórico.

## 8. Testando a Fase 1 (cadastro → papéis → perfil → verificação)

Todas as rotas usam cookie de sessão. No Thunder Client existe a aba **Cookies** — depois do
`/api/auth/register` ou `/api/auth/login`, o cookie `freelaz_session` fica salvo e as próximas
chamadas já vão autenticadas nesta coleção.

**a) Cadastro (CPF, como profissional):**

```
POST http://localhost:3000/api/auth/register
Content-Type: application/json

{
  "documentType": "CPF",
  "document": "52998224725",
  "name": "Maria da Silva",
  "birthDate": "1995-04-12",
  "email": "maria@exemplo.com",
  "phone": "(35) 99999-0000",
  "password": "senhaSegura123",
  "roles": ["PROFISSIONAL"],
  "acceptedTerms": true
}
```

Esperado: `201` com `user` e `roles` — o papel Profissional vem como **PENDENTE**
(só ativa depois da verificação). Um CPF inválido devolve `422 CPF inválido`;
menor de 18 anos devolve `422` com a mensagem de idade mínima; CPF repetido devolve `409`.

**b) Ver o estado da sessão:** `GET /api/auth/me` → `roles`, `professionalProfile`.

**c) Enviar a verificação (CPF):**

```
POST http://localhost:3000/api/verification/professional
Content-Type: application/json

{ "documentUrl": "data:image/jpeg;base64,....", "selfieUrl": "data:image/jpeg;base64,...." }
```

Esperado: `201` com `verification.status = EM_ANALISE`.
A aprovação é **humana** e agora tem painel (Fase 5): abra `http://localhost:3000/admin`,
entre com uma conta que tenha o papel `ADMIN` e use a aba **Identidade** para aprovar
(transação que vira `VERIFICADO` + papel `ATIVO`) ou rejeitar com motivo (permite
reenvio). Sem painel, o mesmo efeito é obtido no **Prisma Studio**:
`IdentityVerification.status = VERIFICADO` e `UserRoleAssignment.status = ATIVO`.
O papel `ADMIN` é concedido à mão (nunca por API).

**d) Editar o perfil:** `PUT /api/profile/professional` com `bio`, `categories`,
`availability`, `experiences` (formato `MM-AAAA`), etc.

**e) Confirmação de e-mail:** o token aparece no **console onde o `npm run dev` está
rodando** (ainda não há provedor de e-mail configurado). Envie em
`POST /api/auth/confirm` com `{ "token": "..." }`.

**f) Recuperação de senha:** `POST /api/auth/password/forgot` com o e-mail →
token no console → `POST /api/auth/password/reset` com `{ "token": "...", "newPassword": "..." }`.

## 9. Bateria de testes automatizados (Fases 1 a 5)

Além do teste manual no Thunder Client, existe uma bateria ponta a ponta em PowerShell que
fala com o servidor de dev via `curl`, mantendo cookie de sessão entre as chamadas.

Pré-requisitos: **banco no ar**, **`npm run dev` rodando** e (para a Fase 1b) o **log do dev
server** à mão — é dele que sai o token de confirmação de e-mail, que ainda aparece só no console.
Para as Fases 3, 4 e 5, o `.env` precisa ter `PAYOUT_SANDBOX=1`, `INTERNAL_API_SECRET` e
`ASAAS_WEBHOOK_TOKEN` preenchidos e `ASAAS_API_KEY` **vazia** (a Fase 4 falha rápido com mensagem
clara se a chave estiver preenchida — ela exercita os caminhos de "sem credencial"), e é preciso
**reiniciar o `npm run dev`** depois de mexer no `.env`.

```powershell
# na raiz do projeto Freelaz:
powershell -ExecutionPolicy Bypass -File .tools\run-all-tests.ps1 `
  -BackendDir .\freelaz-backend `
  -LogFile "C:\caminho\do\log-do-npm-run-dev.out"
```

O que ela faz:

1. `prisma migrate reset --force` — zera o banco (descarta os dados de teste antigos);
2. `test-fase1.ps1` — cadastro, papéis, perfil, verificação (15 assertions);
3. `test-fase1b.ps1` — confirmação de e-mail, verificação do contratante, reset de senha (8);
4. `test-fase1c.ps1` — papel ATIVO, retrofit de segurança, "Me contrate", contraproposta (12);
5. `test-fase2.ps1` — vaga, candidatura, seleção → `Hiring`, chat, contraproposta e suplentes (112);
6. `test-fase3.ps1` — carteira/extrato, códigos de turno, saque com taxa, repasse em lote,
   reconciliação e o segredo das rotas internas (103);
7. `test-fase4.ps1` — camada de confiança: cancelamentos pelas duas partes, janela de liberação
   de 2h, códigos com limite de tentativas (auditoria `CodeAttempt`), webhook real do Asaas
   (duplicado e em paralelo), avaliação mútua, confiabilidade, disputas (devolução, liberação e
   divisão), denúncias, saque após a janela e relatório de concorrência (202);
8. `test-fase5.ps1` — painel admin: bootstrap do `ADMIN` fora da API, autorização rigorosa das
   rotas `/api/admin/*` (anônimo/comum/segredo/sessão ADMIN), fila de identidade com documento
   mascarado, acesso admin às provas, aprovação transacional, rejeição com motivo + reenvio,
   consultas (contratações/repasses/ledger), reconciliação, lote de repasses disparado pelo
   painel, e disputa/denúncia decididas com o **id da sessão** auditado (145);
9. `test-idempotencia.ps1` — **Etapa 1+2 (idempotência de cobrança + customer por usuário)**, passo 8/8, com mock do Asaas
   controlado (`.tools/mock-asaas.mjs`, porta 4010 — nenhum dinheiro real): resposta perdida do
   provedor, falha ao persistir o `providerPaymentId`, duas requisições simultâneas (contratação e
   boost, 3 rodadas cada), repetição sequencial, nova tentativa legítima após exclusão no provedor,
   consulta indisponível, boost sem presumir ausência, preservação do ledger/histórico e listagem
   incompleta (`hasMore` → 503, zero criação) e **customer criado 1× e reutilizado**
    (cenário 11 — `POST /customers` + `customer` obrigatório no pagamento, como no provedor
    real) — **84 asserções**.

Total atual: **681/681** (Fases 1 a 5 = 597 — Fase 1 = 35, Fase 2 = 112, Fase 3 = 103, Fase 4 = 202,
Fase 5 = 145 — + Etapa 1+2 = 84 no passo 8/8). Cada script devolve
exit code ≠ 0 em caso de falha e o encadeamento para na primeira etapa que quebrar. Os scripts
individuais também podem ser rodados sozinhos (`.tools\test-fase1.ps1`,
`.tools\test-fase2.ps1 -BackendDir .\freelaz-backend`, etc.).

> **Por que alguns testes compilam código TypeScript no meio da execução:** nas Fases 2 e 3, o
> webhook do Mercado Pago (provedor anterior) exigia assinatura HMAC e credencial real — por isso
> a validação da máquina de estados, da sincronização do chat e do caminho do dinheiro roda via
> `tsc` compilando os serviços **reais** (`hiringService`, `ledgerService`) para CommonJS, com os
> `.tools/fase2-service-sim.js` e `.tools/fase3-sim.js`. Nada de `hiring.status` nem de lançamento
> no ledger é escrito à mão — o sim da Fase 2 espelha o webhook do Asaas (vaga `PREENCHIDA` +
> `RETIDO` + `recordRetention` na mesma transação). Na Fase 4, o webhook do Asaas não usa HMAC
> (autenticação por `token` no corpo), então a bateria exercita o **webhook HTTP real** — inclusive
> duplicado e simultâneo. No lado do repasse, quem confirma a transferência é o provedor de
> **sandbox** (`PAYOUT_SANDBOX=1`), que não move dinheiro.

## 10. Ambiente portátil (ferramentas dentro do projeto)

Nesta máquina o Node e o PostgreSQL **não estão no `PATH`** — eles vivem em `.tools/`, sem
instalação global. Antes de qualquer comando de Node/Prisma:

```powershell
$env:PATH = "$PWD\.tools\node-v20.20.2-win-x64;$env:PATH"
```

- Postgres: cluster em `.tools/pgdata` (usuário/senha `postgres`, porta 5432, banco `freelaz`).
  Suba com `pg_ctl -D .tools\pgdata -o "-p 5432" start`.
- Prisma baixa engines de `registry.npmmirror.com` — exporte
  `$env:PRISMA_ENGINES_MIRROR = "https://registry.npmmirror.com/-/binary/prisma"` antes de
  `prisma generate`/`migrate` se o download falhar.
- **Pare o `npm run dev` antes de `prisma generate`**: no Windows o engine fica travado
  (`EPERM ... unlink query_engine-windows.dll.node`) enquanto o servidor está de pé.

## Se algo der errado

- Erro de conexão com o banco → confira se copiou a `DATABASE_URL` certinha, com `?sslmode=require` no final (o Neon exige)
- Erro do Prisma sobre "client not generated" → rode `npm run prisma:generate` de novo
- Webhook não chega → confira se a URL cadastrada no painel do Asaas (Integrações → Webhook) é a do ngrok (não `localhost`), aponta para `/api/webhooks/asaas` e usa o mesmo token de `ASAAS_WEBHOOK_TOKEN`
