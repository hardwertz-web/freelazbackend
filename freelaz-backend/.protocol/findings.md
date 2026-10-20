# findings.md — Freelaz

Registro de descobertas e restrições técnicas encontradas ao longo do desenvolvimento. Consulte antes de tomar decisões que possam esbarrar em algo já descoberto.

---

## Pagamentos — Asaas (migração decidida sobre o Mercado Pago)

- **Decisão humana registrada: migrar os pagamentos do Mercado Pago para o Asaas.** Motivo: no Mercado Pago não havia confirmação de acesso self-service à API de transferência Pix para terceiros em conta padrão (era o maior risco técnico da Fase 3); no Asaas, a transferência Pix de saída (`POST /transfers`) é autoatendível em contas padrão. A migração foi feita preservando os dados (RKEEP) e sem reescrever o que já funcionava.
- O modelo de dinheiro **não mudou**: "coletar tudo, repassar depois". O Freelaz é o único merchant of record; o pagamento (Pix) entra na conta Asaas do Freelaz e o repasse ao profissional é uma transferência Pix separada, disparada só após a conclusão (gate de 2h + sem disputa aberta). Split/`application_fee` não é usado.
- **Cobrança**: `POST /payments` da API do Asaas + QR Code por `GET /payments/{id}/pixQrCode`. `POST /api/payments/create` e `POST /api/jobs/boost` devolvem **503** se `ASAAS_API_KEY` estiver vazia — não existe "sucesso simulado" sem credencial. **Atenção (correção da Etapa 1):** o cabeçalho `idempotencyKey` que antes se afirmava "repetir a chamada devolve a mesma cobrança" **não é documentado** na spec atual do Asaas (a OpenAPI de `/v3/payments` e `/v3/transfers` declara `"parameters": []`) — ele segue sendo enviado por precaução, mas como **best-effort não verificado**. A proteção real contra duplicidade é aplicacional, ver próximo item.
- **Webhook** (`POST /api/webhooks/asaas`): autenticado pelo campo `token` do corpo comparado a `ASAAS_WEBHOOK_TOKEN` com comparação à prova de tempo (timing-safe) — o Asaas não assina HMAC. Com `ASAAS_API_KEY` definida, o backend **rebusca o pagamento na API** antes de agir; sem confirmação no console do Sandbox, o status real permanece `PENDING` e o evento é aceito/ignorado (a transição para RETIDO exige pagamento confirmado). **Validado em Sandbox real (exec4):** webhook com corpo real aceito e reenvio idempotente.
- **Eventos tratados**: `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` → `RETIDO` (com trava de concorrência: lock da contratação `SELECT ... FOR UPDATE` + re-cheque de status + índice único parcial `LedgerEntry_uma_retencao_por_contratacao` — webhook duplicado ou disparado em paralelo não retém duas vezes); `PAYMENT_DELETED` → `CANCELADO` (somente a partir de `AGUARDANDO_PAGAMENTO`); `PAYMENT_REFUNDED` → estorno via ledger (reembolso total): `EM_DISPUTA` se o serviço já tinha chegado a `CONCLUIDO`, `CANCELADO` nos estados iniciais. Impulsionamento é identificado pelo prefixo `boost:<id>` em `externalReference`.
- **Nomes genéricos após a migração** (dados preservados, RKEEP): `Hiring.providerPaymentId`, `Payout.providerTransferId`, `JobBoost.providerPaymentId`; a coluna `mpPreferenceId` foi removida. Os caminhos das rotas não mudaram — só o webhook trocou de `/api/webhooks/mercadopago` para `/api/webhooks/asaas` (o antigo foi removido, e a dependência `mercadopago` saiu do `package.json`).
- **Produção ainda não habilitada**: trocar `ASAAS_API_URL` para `https://api.asaas.com/v3`, preencher `ASAAS_API_KEY` de produção e testar UMA transferência Pix real de baixo valor antes de liberar o lote semanal (passos registrados em `src/lib/pixProvider.ts`). Enquanto a chave estiver vazia, dinheiro nenhum sai — as rotas de cobrança respondem 503.
- **Sandbox de repasse continua valendo**: `src/lib/pixProvider.ts` mantém o provedor `sandboxPixTransferProvider` (só com `PAYOUT_SANDBOX=1` **e** `NODE_ENV !== "production"`) e, em produção, a fábrica ignora `PAYOUT_SANDBOX` e devolve o placeholder que recusa — `.env` mal configurado não libera dinheiro de brincadeira.
- **Idempotência de cobrança é APLICACIONAL (Etapa 1 — correção autorizada).** `src/services/chargeService.ts` é a única porta de criação de cobrança: (1) **reconcilia antes de criar** consultando `GET /payments?externalReference=...` (filtro documentado — o guia oficial do Asaas manda consultar o resultado anterior antes de recriar); (2) **trava atômica no banco** com a tabela `ChargeAttempt` (`UNIQUE(entity, entityId, attempt)`) — duas requisições concorrentes disputam o mesmo número de tentativa e só uma chama o provedor; (3) **estado ambíguo para**: resposta perdida, erro de rede/5xx ou falha ao persistir deixam a tentativa `PROVIDER_UNCONFIRMED` e o próximo request **não cria nada** sem prova do provedor (ou ele tem a cobrança → adota; ou prova ausência → libera nova tentativa). `FALHOU`/`DELETED` no nosso banco **não** prova que o provedor não criou nada — quem decide é a reconciliação. Um boost por vaga passou a ser garantido pelo banco (`UNIQUE(JobBoost.jobPostingId)`).
- **`externalReference` é o identificador da operação no provedor**: `hiring.id` para contratação e `boost:{id}` para destaque (é o que o webhook casa). Por isso a chave de idempotência aplicacional identifica a **tentativa** (`freelaz:payment:create:{hiringId}:{n}`), não só a entidade.
- **`customer` no `POST /payments` — RESOLVIDO na Etapa 2 (histórico preservado).** *Estado original (pré-Etapa 2):* a OpenAPI de `PaymentSaveRequestDTO` lista `customer` como campo obrigatório e o payload **não** enviava o campo (não havia Cliente cadastrado no Asaas); contra o provedor real isso viraria `400 invalid_customer`, e a regra vigente era "não inventar cliente nem alterar cadastro sem autorização" — decisão registrada em `task_plan.md` como pendência da Etapa 2. **Resolução (2026-10-18/19):** a decisão "cliente por usuário" foi implementada e **exercitada no Sandbox real** (ver a seção "Customer por usuário e webhook real — aprendizados da Etapa 2 (implementação e Sandbox real)"): na 1ª cobrança o backend cria o cliente (`POST /customers`), persiste em `User.asaasCustomerId` e reutiliza (`cus_000009561631`, criado 1× e reutilizado). Este item **deixa de ser pendência**.
- **`transferPix`: o campo `transactionId` e o header `idempotencyKey` não são mecanismos de idempotência documentados** na spec atual de `POST /transfers`. Seguem no payload por compatibilidade, mas a garantia real de não transferir duas vezes é o `Payout` (chave única + status controlado, `payoutService.isAlreadyProcessed`). Comentário corrigido no código.

## Identidade, papéis e verificação (Fase 1)

- **Papel Profissional nasce `PENDENTE`**, não ATIVO: o CLAUDE.md diz que ativar o papel Profissional exige documento + selfie (ou CNPJ). Já o Contratante nasce ATIVO (a "verificação leve" é o selo, não uma trava para publicar vaga). Quem escrever as regras de busca/candidatura da Fase 2 **precisa checar `status === "ATIVO"`** — existem contas com papel PENDENTE no banco.
- **Aprovação da verificação é humana e tem painel (Fase 5).** O efeito é o mesmo de sempre: `IdentityVerification.status = VERIFICADO` **e** `UserRoleAssignment.status = ATIVO` (agora numa transação, com `decidedById` de auditoria). A aprovação **nunca** é automática nem autoatribuível: o papel `ADMIN` é concedido à mão pelo operador (Prisma Studio/script) e o painel `/admin` só troca a aprovação manual no Prisma Studio por uma tela — a regra (decisão humana) é a mesma.
- **CNPJ alfanumérico**: desde 2026 a Receita emite CNPJ com letras. A validação em `src/lib/document.ts` cobre os dois formatos (valor do caractere = ASCII − 48).
- **Telefone ainda não é confirmável** (sem provedor SMS/WhatsApp). O selo de Contratante verificado usa só o e-mail confirmado por enquanto; quando o provedor entrar (Fase 6), exigir os dois.
- **Sem dependência de auth externa**: senha com `scrypt` do Node e sessão = token opaco com hash no banco (`Session`). Motivo: bcrypt/jsonwebtoken trazem build nativo ou segredo a gerenciar; a sessão em banco ainda dá revogação real. Não trocar por JWT sem necessidade.
- **Arquivos enviados ficam em `uploads/` no disco** (fora do Git). Em produção isso precisa virar storage de objeto (S3/R2) — hoje a rota `/api/uploads/...` só protege por dono, não há CDN nem varredura de conteúdo.

## Segurança das rotas (retrofit da Fase 1)

- Todas as rotas de negociação usam a **sessão** para decidir quem age: `/api/jobs/invite` ignora qualquer `contractorId` do corpo; `/counter-offer` e `/respond` deduzem o lado (CONTRACTOR/PROFESSIONAL) da sessão. Não voltar a aceitar esses campos do cliente.
- `/api/payouts/release` é rota interna: exige `x-internal-secret` em produção (a Governança Financeira proíbe liberação por ação manual livre). O gatilho automático de conclusão ainda não existe (Fase 4).

## Lacunas conhecidas (não são bugs de leitura, são trabalho pendente)

- **Ambiente de dev desta máquina é portátil** (`.tools/`): Node e Postgres não estão no `PATH`.
  Comandos precisam de `$env:PATH = ".tools\node-v20.20.2-win-x64;$env:PATH"`. Subir o Postgres: `pg_ctl -D .tools\pgdata -o "-p 5432" start`. Prisma precisa de `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma`.
- **Downloads diretos grandes falham no meio** (`SEC_E_DECRYPT_FAILURE`): usar `curl -C -` em loop. Registry npm do usuário aponta para `https://registry.npmmirror.com`.
- **Protótipo visual `design-reference/freelaz-prototipo.html` não existe nesta máquina** (busca recursiva em `C:\Users\PC` só acharia `freelaz-backend.zip`). Enquanto não aparecer, **não criar telas nem cores novas** — só API.
- **Resolvido na Fase 2 (não tratar como lacuna):** `selectCandidate` já cria o `Hiring` (`createHiringForApplication`); existem rotas de criação de vaga pública (`POST /api/jobs`), candidatura (`POST /api/jobs/[id]/apply`) e os modelos `Chat`/`Message` (chat derivado do status da contratação).
- **`RETIDO → EM_ANDAMENTO` — RESOLVIDO na Fase 3 (não tratar como lacuna).** O gatilho é o código de abertura digitado pela empresa (`POST /api/hirings/[id]/codes` → `markOpeningCodeUsed`), e os códigos são gerados pelo agendador adiantado `POST /api/cron/shift-codes` (janela de 55–65 min antes de `startsAt`/`endsAt`). Os códigos de fechamento seguem a mesma janela, mas exigem o status `EM_ANDAMENTO`.
- **O webhook do Mercado Pago não era simulável sem sandbox** (exigia assinatura HMAC válida + credencial real para buscar o pagamento). Por isso a validação da máquina de estados usa `.tools/fase2-service-sim.js` e `.tools/fase3-sim.js` — ambos compilam os serviços **reais** (`hiringService` e `ledgerService`) com `tsc` e chamam `setHiringStatus`/`recordRetention` de verdade, replicando o passo do webhook. Não é inserção forjada no banco. **Resolvido na migração para o Asaas (Fase 4):** o webhook do Asaas é autenticado por token no corpo (sem HMAC), então a Fase 4 exercita o webhook **HTTP real** (inclusive duplicado e em paralelo). Os sims continuam em uso nas Fases 2 e 3 por já estarem validados ali.

## Dinheiro e repasse (Fase 3)

- **A liberação É a transferência Pix — não existe tabela de "saldo disponível" intermediário.** Quando o serviço está `CONCLUIDO`, o dinheiro que pode sair fica em `disponivelCents` *calculado* a partir das contratações e dos `Payout`; nada é armazenado como número solto (mesma filosofia do ledger). **Não houve migração de schema nova na Fase 3** por isso mesmo: a taxa do saque é derivável (`netValueCents − payout.amountCents`) e a reconciliação é stateless.
- **Só existe UM `Payout` por contratação** (`Payout.hiringId` é único): repetir a liberação com payout `CONCLUIDO` é no-op, com `PROCESSANDO` é recusado, com `FALHOU` tenta de novo (é para isso que serve o status). Payout + lançamento `LIBERACAO` + `LIBERADO` saem **na mesma transação** — senão o dinheiro sairia sem ficar registrado, ou o registro existiria sem o dinheiro sair.
- **A taxa do saque instantâneo é PLACEHOLDER de 100 bps (1%)**, vindo de `INSTANT_WITHDRAWAL_FEE_BPS`. O valor exato **não está fechado pelo produto**; a Fase 5 a torna editável nas Configurações Financeiras. Arredondamento é para baixo — o profissional nunca paga um centavo a mais por arredondamento.
- **Sem chave Pix (`User.pixKey`) o repasse é recusado** antes de criar qualquer `Payout` — erro explícito, não uma falha silenciosa do provedor. A chave é editada por `PUT /api/profile/professional`.
- **Reconciliação reporta, mas não corrige.** Divergência é para humano olhar: a correção manual é um lançamento `AJUSTE` no ledger (que nunca entra automático no cálculo de saldo) com revisão humana. O relatório é **stateless** (logado, não persistido); o painel da Fase 5 o expõe **ao vivo** em `GET /api/admin/reconciliation`. Guardar o histórico é trabalho futuro.
- **Rotas internas** (`/api/cron/payouts`, `/api/cron/reconciliation`, `/api/cron/shift-codes`, `/api/payouts/release`) exigem `x-internal-secret`. Em produção o segredo é obrigatório; em dev ele é cobrado quando `INTERNAL_API_SECRET` está definido, e só fica aberto (com aviso no console) quando não há segredo nenhum — assim a trava é testável.

## Painel administrativo (Fase 5)

- **Dois caminhos de autorização, nenhum fraco:** `/api/admin/*` aceita o **segredo interno** (`x-internal-secret` — infra/testes; comportamento inalterado, segredo errado = 403 na hora, sem tentar sessão) **ou** **sessão de conta com papel `ADMIN` ativo** (caminho do painel no navegador, onde o segredo não pode aparecer no bundle). No caminho da sessão, o `adminId` auditado é o **id do usuário logado**; no caminho do segredo, continua vindo do corpo (`adminId`) por compatibilidade. Não afrouxar isso: o painel nunca abre em dev sem segredo configurado — é sessão `ADMIN` ou nada.
- **O papel `ADMIN` não é autoatribuível.** `POST /api/auth/roles` rejeita `ADMIN` (400); a concessão é sempre manual, fora da API. `isAdmin()` exige papel `ADMIN` **ATIVO** (PENDENTE não passa).
- **`IdentityVerification.decidedById`** guarda quem decidiu cada verificação (aprovação ou rejeição), para auditoria. A rejeição exige **motivo** e devolve o usuário para `NAO_VERIFICADO`, permitindo reenvio (a submissão ignora registros `NAO_VERIFICADO` ao checar pendências).
- **O painel não cria regra nova de dinheiro.** O botão "rodar lote" chama o **mesmo** `processPendingPayouts()` do `/api/cron/payouts` (elegibilidade, idempotência e ledger intactos); a reconciliação (`GET /api/admin/reconciliation`) é **leitura pura** — reporta, nunca corrige nem move dinheiro (correção é `AJUSTE` com revisão humana); o ledger é append-only. Denúncia nunca move dinheiro (inalterado).
- **Uploads e LGPD:** `GET /api/uploads/[...path]` libera `verifications/` e `private/` para conta com papel `ADMIN` (é o que permite ao painel abrir documento/selfie das provas). Continua **401 sem sessão** e **403 para terceiro**. Nas listas do painel (fila de identidade, disputas, denúncias, contratações) o documento **nunca** sai completo — só a forma mascarada (`maskDocument`).
- **Persistência da reconciliação ainda não existe.** O painel consulta a reconciliação **ao vivo** a cada abertura; guardar o histórico (para auditoria/linha do tempo) é trabalho futuro, registrado em `task_plan.md`.

## Testes

- **Bateria completa:** `.tools/run-all-tests.ps1 -BackendDir .\freelaz-backend -LogFile <log-do-dev>`. Reseta o banco uma vez e roda Fase 1 (1a → 1b → 1c), Fase 2, Fase 3, Fase 4, Fase 5 e a Etapa 1+2 (passo 8/8) em sequência, parando na primeira falha. Total atual: **681/681** (Fases 1 a 5 = 597 — Fase 1 = 35, Fase 2 = 112, Fase 3 = 103, Fase 4 = 202, Fase 5 = 145 — + Etapa 1+2 = 84).
- Todos os scripts de teste devolvem **exit code ≠ 0** quando há falha (o encadeamento depende disso).
- `test-fase2.ps1` é **autossuficiente** (cadastra as próprias contas) e valida a sincronização do chat sem depender do log do dev server. Precisa do servidor de dev no ar e do banco resetado/acessível.
- `test-fase3.ps1` também é autossuficiente (contas `empresa3`/`ana3`/`bruno3`) e roda o caminho real do webhook via `.tools/fase3-sim.js`. Exige `PAYOUT_SANDBOX=1` **e** `INTERNAL_API_SECRET` no `.env` do backend (falha rápido com mensagem clara se faltar), porque o repasse precisa do provedor de sandbox e as rotas internas precisam do segredo para a trava ser exercitada.
- `test-fase4.ps1` (contas `empresa4`/`ana4`/`bruno4`) exercita o **webhook HTTP real** do Asaas (token, valor errado, desconhecido, duplicado e dois envios simultâneos), os três desfechos de disputa (devolução, divisão 50%, liberação), denúncias, limite de tentativas de código e concorrência de seleção. Exige `ASAAS_WEBHOOK_TOKEN` e `ASAAS_API_KEY` **vazia** (fail-fast se a chave estiver preenchida — a bateria cobre os caminhos "sem credencial").
- `test-fase5.ps1` (contas `empresa5`/`ana5`/`bruno5`) é autossuficiente e **concede `ADMIN` via Prisma** (como o operador faria uma única vez), depois exercita: autorização das rotas admin (anônimo/comum/segredo/sessão ADMIN), `ADMIN` não autoatribuível, fila de identidade mascarada + acesso admin às provas, aprovação transacional, rejeição com motivo + reenvio, consultas (contratações/repasses/ledger), reconciliação, lote disparado pelo painel e disputa/denúncia decididas com o id da **sessão** auditado. Exige `INTERNAL_API_SECRET`, `ASAAS_WEBHOOK_TOKEN` e `PAYOUT_SANDBOX=1` no `.env` (fail-fast se faltarem; `ASAAS_API_KEY` vazia).
  - Caveat achado na validação: `saveDataUrlFile` devolve `url` já como `/api/uploads/...`; o teste prependava `/api/uploads/` de novo e caía em 308. Usar o caminho devolvido pela API, não remontá-lo.
- **Etapa 1 (idempotência) — `test-idempotencia.ps1` (passo 8/8 da bateria).** Autossuficiente e **controlado**: para o dev server, sobe um **mock do Asaas** (`.tools/mock-asaas.mjs`, porta 4010) e reinicia o servidor com `ASAAS_API_KEY` de mock + `ASAAS_API_URL` apontando para o mock; ao final restaura o servidor normal (sem credencial) e limpa as variáveis do ambiente. O harness `.tools/test-idempotencia.mjs` roda contra as **rotas reais** e o **banco real** (contas criadas via API, contratações semeadas via Prisma) e cobre: resposta perdida, falha ao persistir `providerPaymentId`, concorrência 2×2 (3 rodadas cada, hiring e boost), repetição da mesma chamada, nova tentativa após exclusão no provedor, consulta do provedor indisponível, boost `FALHOU`, preservação do ledger/histórico e **listagem incompleta (`hasMore === true` → 503, zero criação, recuperação sem duplicata)** — e, desde a Etapa 2, **customer criado 1× e reutilizado** (cenário 11: `POST /customers` + recusa em `POST /payments` sem `customer`, como no provedor real) — 11 cenários, **84 asserções**. O mock reproduz o contrato real de paginação do `GET /payments` (`limit` padrão 10/máx. 100, `offset`, envelope com `hasMore`/`totalCount`) e tem o modo `listMode: "incomplete"`. **Nenhum teste existente foi alterado** — este passo é aditivo. Total atual: **597 (existentes) + 84 (Etapa 1+2)**.
- **Caveat de PowerShell 5.1:** `Set-Content -Encoding utf8` grava BOM; os corpos de requisição saem com `EF BB BF` à frente. Funciona porque o `TextDecoder` do Node (usado pelo `req.json()`) remove o BOM inicial — não "corrigir" isso sem testar. Um JSON vindo de `ConvertFrom-Json` com array `[]` vira `$null` no PS 5.1: sempre usar `@(...).Count` para contar itens.
- **Caveat de encoding de `.ps1` (causou 97 erros de parse):** o Windows PowerShell 5.1 lê arquivos **sem BOM** como ANSI (codepage do sistema) — um `.ps1` UTF-8 sem BOM contendo não-ASCII (ex.: em-dash `—` gravado como `â€"`) quebra o parser catastroficamente com erros em cascata que não apontam a linha real. Regras: (a) escrever `.ps1` 100% ASCII sempre que possível; (b) se contiver não-ASCII, garantir **UTF-8 com BOM + CRLF** (normalizar após gravar); (c) validar sempre com `[System.Management.Automation.Language.Parser]::ParseFile` antes de rodar. Verificado empiricamente: mesmo arquivo = 97 erros sem BOM, 0 com BOM.
- **Caveat de here-string expandável:** em `$js = @"..."@` (expandável), `$disconnect` e similares são interpretados como variáveis PowerShell e expandem para vazio (`prisma.$disconnect()` vira `prisma.();` — SyntaxError no Node). Em here-strings `@"` que interpolam variáveis, escape literais como `` `$disconnect ``; em here-strings `@'` (literais) não há expansão e não precisa de escape.

## Idempotência de cobrança — aprendizados da Etapa 1 (pós-auditoria)

- **Completude da listagem é requisito da prova de ausência.** O `GET /payments` do Asaas pagina (contrato oficial em docs.asaas.com > "Listagem e paginação": `limit` padrão 10/máx. 100, `offset`, envelope com `hasMore` e `totalCount`). Regra implementada em `chargeService.reconcile()`: `hasMore === false` → listagem completa (ausência comprovada); `hasMore === true` → página truncada; `hasMore` ausente → desvio do contrato documentado. Nos dois últimos casos a criação é **interrompida com 503** — nunca se decreta ausência com página incompleta (poderia existir cobrança ativa fora da página lida). **Não presumir completude só porque retornaram menos de 100 itens.**
- **O mock deve reproduzir o envelope real.** O mock antigo devolvia `{ data, totalCount }` sem `hasMore` e ignorava `limit` — um contrato irreal que escondia o gap de completude. Hoje devolve `limit`/`offset`/`hasMore`/`totalCount` e aceita `listMode: "incomplete"` (página truncada) para exercitar o guard. Mock permissivo demais dá falsa confiança: o gap só ficou visível ao comparar com o contrato oficial.
- **`customer` no `POST /payments` — RESOLVIDO na Etapa 2 (histórico abaixo).** docs.asaas.com/reference/criar-nova-cobranca marca `customer` como `required` ("Identificador único do cliente no Asaas"; o guia de cobranças manda enviar o id no campo `customer`). *Estado original (Etapa 1):* o payload **não** enviava o campo — contra o provedor real isso viraria `400 invalid_customer`; era pendência bloqueante do Sandbox. **Resolução:** a decisão "cliente por usuário" foi implementada (`POST /customers` + `User.asaasCustomerId`, sem PII nova) e comprovada no Sandbox real (cliente `cus_000009561631` criado 1× e reutilizado). A menção original a "mapeamento de PII" fica como histórico do que se evitou.
- **4xx só é "recusa definitiva" com evidência de contrato.** Para `POST /payments`, 400/401/403/404/422/429 são recusas de pré-processamento (nenhuma cobrança é criada) → estado `REJECTED` (502) e nova tentativa é segura; rede/timeout/5xx permanecem **ambíguos** (503, nunca nova criação). Para a **listagem** não existe "404 = não existe": qualquer erro ali significa indisponibilidade da prova.
- **`ChargeAttempt` admite várias `CONFIRMED` legítimas por operação** — só após exclusão real da cobrança anterior no provedor (cenários 6 e 8e). O invariante é: **nunca duas `CONFIRMED` com o mesmo `providerPaymentId`** e o alvo sempre aponta para a **última** tentativa. Conferência independente pós-bateria: `GROUP BY providerPaymentId HAVING COUNT(*) > 1` → vazio.
- **Caveat de captura de exit code no PowerShell 5.1:** `Start-Process -PassThru` + `.ExitCode` pode devolver **vazio** mesmo após `WaitForExit()` — não usar para gravar exit de bateria. Clássico bloqueio: `*>` cria pipe e o processo filho (ex.: dev server restaurado pelo harness) herda o handle e segura o EOF para sempre. Padrão confiável: `cmd /c "powershell -File script.ps1 ... > log 2>&1"` + `$LASTEXITCODE` capturado logo em seguida (redirect direto em arquivo, sem pipe; exit file gravado imediatamente, antes de qualquer comando).

## Customer por usuário e webhook real — aprendizados da Etapa 2 (implementação e Sandbox real)

- **Decisão fechada: `customer` = cliente POR USUÁRIO (e não genérico de teste).** Na 1ª cobrança de cada usuário, `POST /customers` com dados **já cadastrados** no Freelaz (nome/razão social, e-mail, CPF/CNPJ só dígitos, telefone — sem PII nova), id persistido em `User.asaasCustomerId` (migração aditiva `20261018150000_etapa2_customer_usuario`) e reutilizado sempre. Serialização por trava advisory `freelaz:asaas-customer:{userId}` — duas 1ª cobranças simultâneas não criam dois clientes; P2002 → releitura. Se o processo morrer entre a criação no provedor e o commit, fica um cliente órfão inócuo (o próximo request cria outro). Recusa 4xx → 502; rede/5xx → 503, nada cobrado.
- **Mock permissivo mentiu sobre o `customer`.** O mock aceitava `POST /payments` sem o campo — o mesmo contrato irreal que escondia o gap de `hasMore`. Agora reproduz a doc oficial: `POST /v3/customers` (`name`+`cpfCnpj` obrigatórios, envelope `{ errors: [{ description }] }`), `GET /v3/customers/{id}` e recusa em `POST /v3/payments` sem `customer` ou com cliente inexistente (400 `invalid_customer`). Cenário 11 (aditivo) prova criação única + reuso.
- **Webhook com credencial RECONSULTA a API — o corpo não manda.** Com `ASAAS_API_KEY` definida, `/api/webhooks/asaas` ignora o `status` do corpo e usa `getPayment(id)`; sem confirmação no console do Sandbox o status real é `PENDING` e o comportamento correto é **aceitar e ignorar** (sem mudar estado). Enviar `status: "CONFIRMED"` no corpo **não** muda nada — o que muda é confirmar o pagamento no console (ação manual). A transição RETIDO/ledger só ocorre com `APPROVED_STATUSES = ["CONFIRMED", "RECEIVED"]`; emulação com corpo real é legítima, mas a aprovação só se afirma com o pagamento aprovado.
- **`externalReference` ≠ `idempotencyKey`.** A referência real usada pelo webhook/reconciliação é `hiring.id` para contratações e `boost:{boost.id}` para destaque; `freelaz:*:create:{id}:{n}` é só a chave de idempotência. Derivar sempre do código/banco — adivinhar o formato quebra filtros de listagem silenciosamente.
- **`JobBoost.id` ≠ `jobPostingId`:** conferência de alvo de boost que faz join por `jobPostingId` com `ChargeAttempt.entityId` (= `JobBoost.id`) resulta **vazia por vacuidade** e "passa" sem checar nada. A checagem corrigida une por `b.id` (foi o que a conferência da Etapa 2 passou a usar).
- **Salvaguarda do harness Sandbox precisa ser exercitada, não só escrita:** sem chave, `node .tools\sandbox-etapa2.mjs` aborta com exit 2 **antes** de qualquer chamada externa; URL fora de `sandbox.asaas.com` idem. Rodar bateria local nunca deve plugar este arquivo (provedor real ≠ mock).
- **A limpeza automática do harness apaga os próprios pagamentos de teste — e isso inviabiliza a confirmação manual depois.** Verificado por sonda somente-leitura em 2026-10-19 (exec4): os 4 pagamentos da execução (`pay_z6qoyad1heidrjd1`, `pay_djewxnmap7wo669x`, `pay_n1wbx0jcb3h0d7dn`, `pay_dtdmqdgut2zb23to`) ficaram `deleted=true` (excluídos no cenário 8) — o `GET /payments/{id}` ainda devolve o objeto `PENDING` (fantasma), mas **não existe mais cobrança ativa** para o usuário confirmar no console. **Já corrigido no harness:** o modo `--keep-charges` pula a limpeza e mantém as cobranças `PENDING` vivas, imprimindo os ids (`ref` = `hiring.id` ou `boost:{boostId}`) para confirmação manual; `GET` de verificação confirma `deleted=false`. O modo padrão segue limpando (bateria/automação); a limpeza deve ser a **última** etapa opcional.
- **Verificação pós-confirmação virou modo do próprio harness: `--verify <hiringId>`.** Não cria cobrança alguma; reconsulta o pagamento real, exige `CONFIRMED`/`RECEIVED` (senão aborta exit 1 sem enviar webhook), envia o webhook com o corpo REAL do provedor e confere `RETIDO` + chat `ABERTO` + exatamente 1 `RETENCAO` (valor = `grossValueCents`) + idempotência (reenvio do mesmo evento e evento tardio `PAYMENT_RECEIVED` não duplicam).
- **Associação de identificadores (verificada, corrige suposição anterior):** `pay_djewxnmap7wo669x` pertence ao hiring `cmvemrcbb0003fnf8a7xgn7wa` (externalReference confere); o hiring `cmvemrimr0007fnf8e4ymcqyk` (cenário de concorrência) corresponde a `pay_n1wbx0jcb3h0d7dn`. Não confundir os dois ao pedir confirmação manual.
- **Sem confirmação, o estado fica corretamente parado:** após a exec4, ambos os hirings seguem `AGUARDANDO_PAGAMENTO`, com **0** lançamentos de ledger e **sem** chat — coerente com pagamento não aprovado (nada foi fabricado).
- **Status (2026-10-19): transição financeira real COMPROVADA no Sandbox.** O fluxo "cliente por usuário" e o webhook real foram exercitados (exec4 e `--keep-charges`; cliente `cus_000009561631` criado 1× e reutilizado). Após confirmação manual no console, `node .tools\sandbox-etapa2.mjs --verify cmveqi5n80003t5drjb1f4gyu` → **exit 0, 12 OK/0 FALHA**: pagamento `CONFIRMED` no provedor, contratação **`RETIDO`**, chat **`ABERTO`**, exatamente **1 `RETENCAO` = 80000 = bruto**, reentrega e evento tardio **não** duplicam; global `RETENCAO 13 → 14` (**+1 exato**), `REEMBOLSO`/`LIBERACAO` e `ChargeAttempt` inalterados (histórico preservado). O export `Cobrancas.xlsx` (2026-10-19T13:38:36Z) mostrava as 3 como "Aguardando pagamento" antes da confirmação. `pay_77rpr1rlzm2t717v` (hiring `cmveqicd10007t5dr1w3vmvp6`) foi processado e validado depois (`--verify cmveqicd10007t5dr1w3vmvp6` → exit 0, 12 OK/0 FALHA; global `RETENCAO 14 → 15`) — ver Sessão 14 do `progress.md`. `pay_emsiz6eibte8ysgc` (boost) segue aprovado no provedor (`RECEIVED`) e foi **processado e validado** na Sessão 15 (ver abaixo).
- **Boost validado ponta a ponta no Sandbox (Sessão 15, 2026-10-19) — lacuna do verificador fechada.** O ramo de boost (`externalReference` = `boost:{jobBoostId}`) grava `JobBoost=PAGO`+`providerPaymentId` e `jobPosting.urgentBoost=true`, **sem `LedgerEntry`** (boost não tem `hiringId`; a receita do boost não entra no saldo retido) e sem chat; reentrega/evento tardio são no-op (`alreadyProcessed`). Novo modo do harness `node .tools\sandbox-etapa2.mjs --verify-boost <boostId>` (não cria cobrança; recusa antes de enviar webhook se a cobrança não pertencer ao boost/não estiver aprovada). Execução para `cmveqiedg000tfenkjm6nnqsb` → **exit 0, 20 OK/0 FALHA**: `RECEIVED` no provedor + `deleted=false`, webhook 200, `JobBoost PENDENTE → PAGO` com `providerPaymentId=pay_emsiz6eibte8ysgc`, `jobPosting.urgentBoost=false → true`, **ledger 25→25**, **chat 20→20**, **hiring 46→46**, reentrega/evento tardio idempotentes, demais boosts inalterados. Também endurecido: `--verify`/`--verify-boost` **sem valor** agora abortam (exit 2) em vez de cair no fluxo que cria cobranças.
- **Etapa 1: a bateria é 100% mock e `ChargeAttempt.CONFIRMED` ≠ pagamento confirmado.** Os 12 cenários do `test-idempotencia.mjs` rodam contra o provedor MOCK (`mock-asaas.mjs`), reproduzindo os contratos reais (`hasMore`, exclusão fantasma); nenhum toca o Sandbox. `ChargeAttempt.CONFIRMED` significa apenas "o provedor respondeu à criação da cobrança" — a confirmação de pagamento vem do webhook. Rodar cenários 1–10 contra o Sandbox real exigiria **criar cobranças** (fora do autorizado nesta rodada).
- **Critério "cenários 1–10 contra o Sandbox real" é parcialmente infactível (Sessão 16, 2026-10-19).** Os cenários 1 (resposta perdida), 7 (consulta 500) e 10 (`hasMore=true`) e partes de 2 (conflito de persistência) e 8 (estado `FALHOU`) dependem de **fault injection** que o provedor real não permite induzir sob comando — só o mock os reproduz. Dos 10 cenários, apenas 3/4/5/6 (concorrência, repetição, exclusão→nova tentativa) são factíveis contra o Sandbox — e esses já foram exercitados pela **Etapa 2** (`sandbox-exec4.log`, 37 OK: criação, reuso, concorrência 2×2, delete+nova cobrança, cliente 1×), não pelo harness da Etapa 1. Conclusão: o critério precisa ser reformulado (proposta em `task_plan.md`); mantê-lo literalmente bloqueia a Etapa 1 por um motivo não relacionado à correção do código. Reauditoria fresca: bateria mock **92 OK/0 FALHA**, invariantes limpos, `tsc` 0 — **sem FAIL**.
- **Revisão humana do diff de idempotência concluída — sem bloqueador crítico (Sessão 17, 2026-10-19).** Revisados `chargeService.ts`, as rotas de cobrança, `lib/asaas.ts`, as duas migrações aditivas e o `schema.prisma`. Regras centrais corretas e coerentes (reconciliar antes de criar; trava advisory + unicidade; estado ambíguo nunca cria; janela reconcile-then-claim fechada por `priorConfirmed`; tentativa persistida antes do alvo). **Riscos residuais não críticos:** (i) tentativa órfã encerrada como `RECONCILED_ABSENT` só após reconciliação — se o provedor tiver consistência eventual na listagem, uma cobrança recém-criada poderia escapar e originar uma segunda (limitação inerente, sem idempotência garantida pelo provedor); (ii) paginação >100 por `externalReference` (fail-closed ⇒ 503; risco de disponibilidade, não de duplicidade). Etapa 1 classificada como **`APROVADA COM RESSALVAS`**; transferência Pix de baixo valor é gate independente de produção.
- **Revisão formal da Etapa 2 concluída — recomendação `APROVADA COM RESSALVAS` (Sessão 18, 2026-10-19; aguardando aceite humano).** Caminho crítico comprovado no Sandbox real: cobrança → webhook → `RETIDO` + chat + exatamente 1 `RETENCAO`=bruto (2 contratações) e boost `RECEIVED→PAGO`+`urgentBoost` com **zero** ledger (1 boost). Confirmado: pagamento `PENDING` **não** é tratado como aprovado (exec4 §5c/5d); reentrega + evento tardio **não** duplicam (V9–V13 / VB14–VB19; fase4 §1 duplicado e §1b 2 simultâneos); autenticidade do webhook por `token` timing-safe (forjado→401, valor errado→400, desconhecido→404); consulta ao provedor com credencial (`getPayment`) antes de agir; ledger/histórico preservados (sonda fresca: `15/4/6`; **zero** `RETENCAO` duplicada por contratação). **NÃO EXECUTADOS (gates de produção, não bloqueiam a Etapa 2):** reembolso/estorno pós-confirmação (`PAYMENT_REFUNDED`), **chargeback** (o webhook **não** tem ramo explícito — um chargeback após `RETIDO` hoje **não** reverte a retenção, cai em "outros eventos → ignora": tratar antes de produção) e **transferência Pix** de saída; além da **paginação multipágina** (>100, fail-closed). Classificação oficial **não alterada unilateralmente**: segue `FASE 2 VALIDADA NO SANDBOX — REVISÃO PENDENTE` até aceite humano.

## Chargeback Asaas — Etapa 3 (pós-auditoria): implementação e o que ficou pendente

> **Cuidado de escopo:** esta seção documenta a **nova etapa** (Sessão 19). A antiga linha da matriz ("Chargeback → não há ramo explícito → BLOCKED") foi **substituída** pelo ramo implementado; nada anterior foi reclassificado.

- **Regra de ouro adotada: chargeback não move dinheiro automaticamente.** Os 3 eventos oficiais (`PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`) **registram o fato externo** (modelo aditivo `ChargebackEvent`; status e motivo externos **preservados sem tradução** — 32 motivos possíveis; valor em centavos), **vinculam/abrem** a disputa interna, **bloqueiam** o repasse e **sinalizam** para conciliação **humana**. **Nenhum `REEMBOLSO` é criado no evento inicial.** Após `LIBERADO`, o chargeback é registrado e sinalizado (`disputeOpen=true`), mas o pagamento **não** é revertido automaticamente.
- ✅ **P3 CONFIRMADO na doc oficial (2026-10-20) — `AWAITING_CHARGEBACK_REVERSAL` = "Disputa vencida, aguardando repasse da adquirente" (fluxo oficial: `PAYMENT_CHARGEBACK_REQUESTED` → `PAYMENT_CHARGEBACK_DISPUTE` → **quem venceu?** cliente Asaas ⇒ `AWAITING_CHARGEBACK_REVERSAL` → `PAYMENT_CONFIRMED`|`PAYMENT_RECEIVED`; portador ⇒ `PAYMENT_REFUNDED`).** Ou seja: o evento significa que a **plataforma VENCEU** e o valor **volta**. O código **não** deduz desfecho do nome do evento (mantém o bloqueio conservador até desfecho inequívoco/decisão humana — D6, ainda **não decidido** pelo usuário); o comentário em `externalStatusForEvent` foi corrigido para não afirmar o contrário. **Manter o bloqueio aqui é default conservador do usuário, não interpretação errada.**
- **Autenticação por cabeçalho, não por corpo.** O webhook confia no cabeçalho `asaas-access-token` (comparação timing-safe). O fallback `body.token` só vale com `NODE_ENV=test`/`ASAAS_WEBHOOK_ALLOW_BODY_TOKEN=1` — fora do teste, `body.token` **não** autentica. Motivo: o contrato real do Asaas é o cabeçalho; aceitar o corpo em produção abriria uma via de autenticação pelo payload.
- **Persistir antes de responder 200.** Toda entrega vira uma linha `AsaasEvent` (`asaasEventId` **único**) **antes** do ACK; falha ao persistir → 5xx (reenvio at-least-once). Idempotência por `event.id`: reenvio idêntico é **no-op**; entregas simultâneas convergem em **uma** linha e **um** efeito. Evento **desconhecido** (nome fora de `KNOWN_PAYMENT_EVENTS`) → `NAO_TRATADO` (preservado, sem efeito); evento **conhecido** sem efeito → `IGNORADO`. **Nunca** se presume evento novo inofensivo.
- **Bloqueio de repasse é transacional, não checagem otimista.** `releasePayout`/`releasePayoutManually`/lote releem a linha com `SELECT … FOR UPDATE` **dentro da transação** (`payoutBlockReason`) — a guarda do commit **prevalece** sobre a checagem prévia. Com chargeback ativo ou disputa aberta: **422**, `Payout=FALHOU`, **zero** `LIBERACAO`. A seção 9 da bateria prova que webhook-de-chargeback × `releasePayout` concorrentes nunca deixam `LIBERACAO` órfã/duplicada.
- **Decisões humanas pendentes (D1–D8) — NÃO decididas silenciosamente; só as proteções independentes foram implementadas:** **D1** chargeback **após `LIBERADO`** (hoje: registrar+sinalizar, sem reverter — "nunca estornar automaticamente o profissional"); **D2** **déficit** sem saldo elegível (não atribuir déficit a ninguém); **D3** chargeback **parcial** (limitar ao saldo elegível confirmado e sinalizar); **D4** relação **disputa externa × interna** (vincular sem duplicar efeito); **D5** **quem** pode intervir (só admin autorizado, com auditoria); **D6** critério de **desbloqueio** (só desfecho **verificável** ou decisão humana registrada; não desbloquear por timeout); **D7** **quando** registrar `REEMBOLSO` (não no evento inicial; encaminhar à conciliação humana); **D8** **prazo/procedimento** da conciliação (registrar data/prazo; **não** encerrar disputa silenciosamente).
- **Pendências técnicas (P1–P5): RESOLVIDAS por documentação oficial em 2026-10-20 (Etapa 3.1) — ver tabela abaixo.** Nenhuma foi "inferida": todas têm fonte (URL) e data.
- **Validação no Sandbox: NÃO EXECUTADA.** O chargeback **real** não foi gerado; a bateria da Etapa 3 usa **mock** (`.tools/mock-asaas.mjs`, `PAYOUT_SANDBOX=1`). **A doc oficial confirma que o Sandbox NÃO permite chargeback self-service** (⚠️ "envie o ID da cobrança para integracoes@asaas.com.br para solicitar o teste") — logo a validação fica **pendente** até solicitação ao Asaas. Não se simula confirmação real nem se declara Sandbox validado sem evidência observada. **A validação no Sandbox (quando feita) não autoriza produção.**

### Etapa 3.1 — P1–P5 conferidos na documentação oficial (2026-10-20)

| # | Pendência | Status | Fonte | Achado |
| - | --------- | ------ | ----- | ------ |
| **P1** | Contrato de auth do webhook | ✅ **RESOLVIDO** (fonte: https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook + https://docs.asaas.com/docs/criar-novo-webhook-pela-api, 2026-10-20) | O cabeçalho é exatamente **`asaas-access-token`**; o `authToken` é definido **por webhook** (até 10 webhooks/conta); **não há assinatura/HMAC** — só o token. `body.token` **não** é o contrato → o código está correto (cabeçalho; corpo só em teste). |
| **P2** | Payload real de `chargeback` / estabilidade de `event.id` | ✅ **RESOLVIDO** (fonte: https://docs.asaas.com/docs/webhook-para-cobrancas + https://docs.asaas.com/reference/recuperar-uma-unica-cobranca + https://docs.asaas.com/docs/chargeback, 2026-10-20) | O `chargeback` vem **DENTRO de `payment`**. No **webhook** o objeto é **reduzido** (no exemplo oficial: só `status`+`reason`); o objeto **completo** (id/value/disputeStartDate/disputeStatus/deadlineToSendDisputeDocuments) é do **GET** `/payments/{id}/chargeback`. Enums confirmados: `status`=REQUESTED\|IN_DISPUTE\|DISPUTE_LOST\|REVERSED\|DONE; `disputeStatus`=REQUESTED\|ACCEPTED\|REJECTED; `reason`=32 valores. A doc **proíbe traduzir enums no código**. `event.id` = chave de idempotência estável entre reentregas (doc de idempotência). **Divergência corrigida** (ver abaixo). |
| **P3** | Semântica de `AWAITING_CHARGEBACK_REVERSAL` | ✅ **RESOLVIDO** (fonte: https://docs.asaas.com/docs/webhook-para-cobrancas, 2026-10-20) | "**Disputa vencida, aguardando repasse da adquirente**" — venceu o **cliente Asaas (plataforma)**; o evento seguinte é `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`. Não é sinal de perda. Código mantém bloqueio **por decisão conservadora** (D6 pendente), sem afirmar desfecho. |
| **P4** | Política de retry | ✅ **RESOLVIDO** (fonte: https://docs.asaas.com/docs/penalização-de-filas, 2026-10-20) | Backoff progressivo: 0 / 30s / 1m / 3,5m / 5m / 15m / 25m / 1h / 1h / 1h / 1h / 1h / 2h / 2h / 3h; **após 15 falhas consecutivas a fila é pausada** (eventos guardados 14 dias). Sucesso = 2xx. Confirma a premissa do código. |
| **P5** | Base URL do Sandbox | ⚠️ **RESOLVIDO (doc) / DIVERGÊNCIA NO `.env` MANTIDA** (fonte: https://docs.asaas.com/docs/sandbox, 2026-10-20) | A URL **oficial** é **`https://api-sandbox.asaas.com/v3`**; o `.env` usa `https://sandbox.asaas.com/api/v3` (formato **legado**). Ambos respondem (HTTP 401 sem credencial — alias legado ainda ativo). `src/lib/asaas.ts` tem comentário documentando; **`.env` NÃO alterado** (decisão do usuário: só registrar). |

## Workflow de jobs + visibilidade de chargeback (Etapa 3.3)

**Hardening do escape hatch `JOBS_ALLOW_UNTOKEN`.** O escape hatch existe só para o
harness local exercitar o caminho de sucesso sem token. Em produção ele abriria as rotas
`/api/jobs/*/run` — **inclusive o repasse semanal** — para qualquer um. Por isso:
- A checagem pura `isUntokenJobsForbidden(nodeEnv, allowUntoken)` e a de startup
  `assertJobsAllowUntokenSafe(...)` vivem em **`src/lib/jobsStartup.ts`** (módulo **sem**
  `crypto`/`next/server`, para poder ser importado pelo hook de startup sem puxar deps
  Node para o bundle Edge).
- O **startup** é barrado por `src/instrumentation.ts` (`register()`, habilitado por
  `next.config.js` > `experimental.instrumentationHook`), que só roda no runtime Node
  (`process.env.NEXT_RUNTIME === "nodejs"`). Com `NODE_ENV=production` + `JOBS_ALLOW_UNTOKEN=1`
  o app **não sobe** (erro explícito; melhor não subir do que subir inseguro).
- **Limite observado e documentado:** `next dev` **força** `NODE_ENV=development` (o Next
  avisa "non-standard NODE_ENV"), então o caso "produção" não é reproduzível em `dev` — é
  exatamente por isso que a validação tem uma **função pura** testável isoladamente. O teste
  compila `src/lib/jobsStartup.ts` (o código REAL, não uma cópia) e cobre os 3 casos:
  dev+flag = permitido; prod+flag = **lança**; prod sem flag = permitido.

**Visibilidade de chargebacks bloqueados (`GET /api/admin/chargebacks/blocked`).**
Enquanto D1–D8 não é decidido, um chargeback ATIVO bloqueia o repasse e nada marca o
caso como resolvido — o "D6 pendente". Para o admin **ver** esse acúmulo (sem destravar
nada), o endpoint devolve `{ total, porStatus, maisAntigo }`:
- `total` = **contratações** distintas bloqueadas (`ChargebackEvent.state = "ATIVO"` +
  `hiring.status = "CONCLUIDO"` — o MESMO critério de `payoutBlockReason` →
  `hasActiveChargeback`, agora extraído para `chargebacksBlockingPayout` no
  `asaasEventService` para não duplicar regra);
- `porStatus` = distribuição do status externo **cru** (REQUESTED/IN_DISPUTE/...);
- `maisAntigo` = `{ hiringId, bloqueadoDesde }` do registro ativo mais antigo.
- **SOMENTE LEITURA**: não desbloqueia, não muda `state`/`payoutBlockReason`, não move
  dinheiro. Guarda igual à dos demais `/api/admin/*` (`checkAdminAccess`). Nunca devolve
  payload bruto/PII.

**Log estruturado na reconciliação diária.** O job `POST /api/jobs/daily-reconciliation/run`
emite, ao final, **uma linha sem PII**:
`[Freelaz][reconciliacao] chargebacks bloqueando repasse=N mais antigo há X dia(s)`.
Usa o mesmo helper `chargebacksBlockingPayout`. **Não** altera `ok`/`discrepancies` do
relatório nem qualquer estado — é só observabilidade (o serviço `runReconciliation`
continua puro/somente-leitura; o log é emitido na rota do job).

**Workflow GitHub Actions (`.github/workflows/jobs.yml`).** 4 schedules + `workflow_dispatch`:
`opening-codes`/`closing-codes` a cada **15 min** (`*/15 * * * *`), `weekly-payout`
segunda **03:00 UTC** (`0 3 * * 1`), `daily-reconciliation` **04:00 UTC** (`0 4 * * *`).
Cada job chama `POST ${JOBS_URL}/api/jobs/<job>/run` com `x-jobs-token:
${{ secrets.JOBS_RUN_TOKEN }}`. **⚠️ O workflow só é útil quando o secret `JOBS_URL` for
configurado** — enquanto não existe deploy, `JOBS_URL` não está definido e as chamadas
falham (URL vazia); é intencional. **Nenhum secret foi criado** (só o arquivo); tokens
vivem apenas em `secrets.*`.

**Template de decisão D1–D8.** Criado `.protocol/decisions/D1-D8.md` — **matriz de apoio,
não decisão**: para cada D1–D8 lista problema, default conservador atual, 2–3 alternativas
com prós/contras e o que muda em código/schema. **Nenhuma alternativa marcada**; traz a nota
"Não implementar sem aprovação explícita". Nenhum service/política de reembolso foi criado
ou alterado.

## Etapa 4 — D6=A2 (desbloqueio em desfecho verificado) e D8=A2 (escalonamento)

> **Decisões aprovadas pelo usuário em 2026-10-20** (ver `.protocol/decisions/D1-D8.md`).
> Das 8 decisões, **apenas D6=A2 e D8=A2 exigem código**; D1=A1, D2=A1, D3=A1, D4=A1, D7=A1
> mantêm o default (nenhum código novo) e D5=A1 já estava implementado (Etapa 3). **Nada
> de D1–D5/D7 foi tocado.**

### D6=A2 — quais eventos ENCERRAM o chargeback (`ATIVO` → `ENCERRADO`)

**Fonte da doc (tarefa 1):** `https://docs.asaas.com/docs/payment-events` (consultada
**2026-10-20**): *"When the dispute is won by the Asaas customer, the event after
`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` will be `PAYMENT_CONFIRMED` or `PAYMENT_RECEIVED`,
depending on whether the charge has already reached its credit date."* (Corrobora P3.)

Conjunto **MAIS RESTRITIVO** adotado (`CHARGEBACK_WON_EVENTS`): apenas os dois eventos
que a doc lista como desfecho de ganho — **`PAYMENT_CONFIRMED`** e **`PAYMENT_RECEIVED`**.

| Evento (Asaas) | Encerra chargeback ATIVO? | Condição | Fonte |
| --- | --- | --- | --- |
| `PAYMENT_CONFIRMED` | **SIM** (evento de ganho) | + chargeback ATIVO correlacionado **e** status compatível | docs.asaas.com/docs/payment-events (2026-10-20) |
| `PAYMENT_RECEIVED` | **SIM** (evento de ganho) | idem | docs.asaas.com/docs/payment-events (2026-10-20) |
| `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` | **NÃO sozinho** | só "aguardando repasse da adquirente" (P3) | docs.asaas.com/docs/webhook-para-cobrancas |
| `PAYMENT_CHARGEBACK_REQUESTED` / `PAYMENT_CHARGEBACK_DISPUTE` | **NÃO** | são ABERTURA/andamento, nunca ganho | idem |
| Qualquer outro / timeout | **NÃO** | timeout seria D6=A3 (**rejeitado**) | decisão do usuário |

Critério do **status do provedor** compatível com ganho (`isVerifiedWonStatus`), o mais
restritivo: `status ∈ {DONE, REVERSED}` **ou** `disputeStatus = ACCEPTED`. `IN_DISPUTE`/
`REQUESTED` **não** encerram; `DISPUTE_LOST` **nunca** encerra como ganho.

**O que NÃO faz parte do desbloqueio (não negociável):**
- `AWAITING_CHARGEBACK_REVERSAL` **sozinho** não encerra (é espera, não desfecho);
- **timeout** não encerra (seria D6=A3, rejeitado);
- evento de ganho **sem** chargeback ATIVO correlacionado é **no-op** (não cria nem altera
  `ChargebackEvent`);
- **NÃO** cria `REEMBOLSO` (D7=A1), **NÃO** reverte `LIBERADO` (D1=A1), **NÃO** toca em
  `payoutBlockReason` (o desbloqueio é **consequência** da guarda transacional, que deixa
  de achar `ATIVO`);
- **NÃO** mexe em `payoutService.ts` (nenhuma alteração).

**Implementação:** `closeChargebackOnVerifiedOutcome(tx, event, paymentId, body)` em
`asaasEventService.ts`, chamada no webhook (`route.ts`) no ramo de pagamento aprovado.
Grava `state="ENCERRADO"` + `closedAt` + `closedReason` (`desfecho_verificado:<evento>`).
Idempotente: reenvio do mesmo evento (ou evento de ganho repetido) é **no-op** — só há
`ATIVO` para encerrar uma vez. Migração **aditiva** `20261020180000_etapa4_chargeback_desfecho_verificado`
(adiciona `closedAt`/`closedReason`; nenhuma linha existente alterada).

**Escopo deliberadamente mínimo:** a **disputa interna automática** (`system:asaas_chargeback`)
e `disputeOpen` **não** são alterados por D6=A2 — resolvê-la moveria dinheiro via
`resolveDispute` (violaria D7/D1) e reverter `EM_DISPUTA → CONCLUIDO` seria reversão de
estado não autorizada. A decisão de destravar a disputa segue humana (D5=A1).

### D8=A2 — job de escalonamento (somente leitura)

Novo service `chargebackEscalationService.ts` (`escalateChargebacksNearDeadline`) e rota
`POST /api/jobs/chargeback-escalation/run` (auth `x-jobs-token`, mesmo padrão). Lê
`ChargebackEvent` com `state="ATIVO"` e `deadlineToSendDisputeDocuments` não-nulo, calcula
`diasRestantes` e devolve `{ vencendo: [...], vencidos: [...] }` (janela default 3 dias).
**Somente leitura:** NÃO encerra, NÃO muda `state`, NÃO cria lançamento, NÃO chama o
provedor. Log estruturado sem PII (`vencendo=N vencidos=M`). Schedule diário `0 5 * * *`
no `.github/workflows/jobs.yml` (após a reconciliação).

## Agendamento de jobs (Etapa 3.2)

Os 4 jobs têm **rotas finas** (`POST /api/jobs/<nome>/run`, autenticadas por `x-jobs-token` = `JOBS_RUN_TOKEN`), mas **quem os chama periodicamente é externo ao processo**: o agendador é **infraestrutura**, não código do app. As rotas são a superfície estável; o agendador só as chama.

**Opção escolhida: A — GitHub Actions cron** (recomendada para MVP).

**Justificativa:** o projeto **não tem deploy Vercel definido** (não há `vercel.json`, nem projeto Vercel no repo) → a Opção B não se aplica hoje. GitHub Actions é gratuito em repo público (e generoso em privado), **não depende de deploy**, versiona o cron junto do código e o segredo fica em `secrets.JOBS_RUN_TOKEN` (nunca no repo). Se/quando houver deploy Vercel, a Opção B passa a ser preferível (mais simples) — a troca **não** toca as rotas.

**Exemplo de workflow (`.github/workflows/jobs.yml`)** — chamadas com `curl`; o token vem de secret e **nunca** é impresso:

```yaml
name: jobs
on:
  schedule:
    # Códigos de turno: a cada 5 min (a janela do service é 55–65min antes)
    - cron: "*/5 * * * *"
    # Repasse semanal: segunda 06:00 UTC
    - cron: "0 6 * * 1"
    # Reconciliação diária: todo dia 07:00 UTC
    - cron: "0 7 * * *"
  workflow_dispatch: {}   # permite rodar manualmente pelo painel do GitHub
jobs:
  shift-codes:
    if: github.event.schedule == '*/5 * * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: abrir/fechar códigos de turno
        run: |
          set -e
          for job in opening-codes closing-codes; do
            curl -fsS -X POST "https://SEU_DOMINIO/api/jobs/$job/run" \
              -H "x-jobs-token: ${{ secrets.JOBS_RUN_TOKEN }}"
          done
  weekly-payout:
    if: github.event.schedule == '0 6 * * 1'
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "https://SEU_DOMINIO/api/jobs/weekly-payout/run" \
            -H "x-jobs-token: ${{ secrets.JOBS_RUN_TOKEN }}"
  daily-reconciliation:
    if: github.event.schedule == '0 7 * * *'
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "https://SEU_DOMINIO/api/jobs/daily-reconciliation/run" \
            -H "x-jobs-token: ${{ secrets.JOBS_RUN_TOKEN }}"
```

**O que NÃO fazer:**
- **`setInterval`/`node-cron` dentro do processo Next** — não sobrevive a restart/redeploy (Vercel serverless nem mantém o processo vivo), e em múltiplas instâncias o job rodaria N vezes em paralelo. O agendador tem de ser **externo**.
- **Deixar `JOBS_RUN_TOKEN` vazio em produção** — as rotas respondem 401 e o job nunca roda (o token é obrigatório em produção; ver `.env.example`).
- **Usar o mesmo segredo do painel admin** (`INTERNAL_API_SECRET`) como token de job — separados de propósito: vazar um não dá o outro.
- **Colocar o token no repositório ou no YAML** — sempre via `secrets.*`.
- **Confiar no cron como única garantia de execução** — os jobs são **idempotentes por estado** e podem ser re-disparados com segurança (é o que garante o retry `curl -f`).
- **Agendar o repasse semanal sem revisar a janela de avaliação** — `processPendingPayouts` já respeita a janela e as guardas de disputa/chargeback; não afrouxar isso no agendador.

- **Rota inexistente → 404:** qualquer `/api/jobs/<nome-desconhecido>/run` responde 404 (comportamento padrão do Next). **Testado.**

### Etapa 3.2 — INSPECT: jobs já implementados em `src/services/`

Levantamento feito **antes** de criar qualquer rota (nenhuma assinatura foi inventada). Cada linha é a função **real** existente.

| Job | Arquivo | Assinatura | Já idempotente? | Retorna |
| --- | ------- | ---------- | --------------- | ------- |
| **Código de ABERTURA** | `src/services/codeService.ts` | `generateOpeningCodesDue()` | ✅ **Sim** — só pega contratações `RETIDO` com `openingCode: null` na janela 55–65min; grava uma vez e nunca regrava (a condição `openingCode: null` deixa de casar). Rodar 2x → 2ª vez devolve 0. | `number` (quantidade gerada) |
| **Código de FECHAMENTO** | `src/services/codeService.ts` | `generateClosingCodesDue()` | ✅ **Sim** — mesma lógica com `closingCode: null` e status `EM_ANDAMENTO` na janela. | `number` |
| **Repasse semanal** | `src/services/payoutService.ts` | `processPendingPayouts(): Promise<BatchPayoutResult>` | ✅ **Sim** — só pega `CONCLUIDO` sem Payout (ou com FALHOU) fora da janela de avaliação; `releasePayout` devolve o Payout existente se já `CONCLUIDO` (idempotência por `payout.hiringId` único + `idempotencyKey`). | `{ eligible, released: string[], failed: {hiringId,error}[] }` |
| **Reconciliação diária** | `src/services/reconciliationService.ts` | `runReconciliation(): Promise<ReconciliationReport>` | ✅ **Sim (por natureza)** — **não escreve nada**: só lê e reporta invariantes. Rodar 2x é inofensivo por construção. | `ReconciliationReport` (ok, totals, checks, discrepancies, external) |

- **LACUNA registrada (não inventada):** não existe **agendador** (nenhum cron/`setInterval`/fila no código) nem **registro genérico de execução de job** (não há modelo `JobRun`/`IdempotencyKey` genérico — a única idempotência persistida é `Payout.idempotencyKey`). As rotas antigas (`/api/cron/shift-codes`, `/api/cron/payouts`, `/api/cron/reconciliation`) existem e são protegidas por `x-internal-secret`, mas **não** têm um token dedicado de jobs nem métrica de execução.
- **Consequência de projeto:** como todos os 4 serviços já são idempotentes por **estado no banco** (condição de elegibilidade que deixa de casar após o efeito), **NÃO** é necessária uma chave de idempotência nova para os jobs — a idempotência é observável e será **testada** (2ª execução → 0 novos efeitos). Envolver com chave sintética (`job:...:2026-10-20`) seria redundante e criaria estado novo sem necessidade; **não foi feito** (registrado como decisão, não como omissão).

- **Divergências reais corrigidas na Etapa 3.1 (P2):**
  1. **`chargeback` lido de `payment.chargeback`** (contrato real); `body.chargeback` no topo é aceito só como **fallback legado**. Antes o parser só lia o topo.
  2. **Campos de data reais**: `disputeStartDate` e `deadlineToSendDisputeDocuments` (o código supunha `createdDate`/`updatedDate`, que **não existem** no objeto). Colunas aditivas novas `providerDisputeStartDate`, `deadlineToSendDisputeDocuments`, `providerDisputeStatus` (nomes legados mantidos).
  3. **`disputeStatus`** passa a ser capturado cru.
- **Fixture versionado:** `.tools/fixtures/asaas-chargeback.json` (`_source` + `_captured_at`), com os 3 eventos em **dois formatos** (webhook enxuto e GET completo) e os enums oficiais. Usado pelos testes (seção 4b) — **não** é captura de tráfego.
- **Script de Sandbox real:** `.tools/sandbox-chargeback-real.mjs` (somente leitura, guarda de Sandbox). Sem chargeback observado → **`PENDENTE` (exit 3)**, nunca "validado".
- **Migração aditiva:** `20261020120000_etapa3_asaas_eventos_chargeback` (`AsaasEvent`, `ChargebackEvent`, relações reversas em `Hiring.chargebacks` e `Dispute.chargebacks`). Nenhum modelo/tabela existente foi alterado; ledger histórico intacto.
- **Evidência de teste (mock + banco de dev):** `.tools/test-chargeback.mjs`/`.ps1` = **60 OK/0 FALHA** (9 seções: auth; durabilidade/idempotência; chargeback RETIDO; DISPUTE/AWAITING; órfão; bloqueio transacional; pós-`LIBERADO`; disputa concorrente; webhook × `releasePayout`). Bateria completa `run-all-tests.ps1` → **`BATTERY_EXIT=0`**, `749 OK / 0 FALHA` (Fases 1–5 = 597; Etapa 1+2 = 92; Etapa 3 = 60). `tsc --noEmit` exit 0; `npm run build` exit 0.

## Ferramental

- A versão mais recente do Prisma CLI (testada durante o projeto) mudou radicalmente de paradigma (`prisma contract emit/infer/format/print`, estilo "Prisma Platform"), diferente do clássico `prisma generate`/`prisma migrate dev`/`prisma validate`. O `package.json` do projeto fixa a versão `5.17.0`, que usa os comandos clássicos documentados no README — **não atualizar o Prisma sem testar antes**, a CLI nova quebra os comandos do README.

## Modelo de negócio (decisões já fechadas, não reabrir sem motivo forte)

- Comissão de vaga freelance: **10% fixo para todos**, sem progressão por duração.
- Plano CLT: valor com faixas progressivas, ainda não fechadas em número exato — ver `CLAUDE.md`, seção "Modelo de cobrança".
- Sem verificação de antecedentes criminais — decisão deliberada de inclusão, não um esquecimento.
- Cancelamento e "desfazer match" foram unificados num caminho só — não recriar uma rota neutra separada.
- "Me contrate" não é um sistema à parte — é uma vaga `PRIVADA` no mesmo modelo `JobPosting`/`Application` de sempre, com campo de contraproposta.
- Influenciador digital não tem fluxo próprio — é só mais uma categoria de profissional.

## Riscos de produto identificados (não resolvidos no código, só documentados)

- Pagamento acontece antes de qualquer troca de mensagem entre as partes — risco de atrito identificado, mas a decisão do usuário foi manter assim, confiando na retenção do saldo como proteção suficiente.
- Suplentes "parados no tempo": resolvido parcialmente com o filtro automático de conflito de agenda (`listSubstitutes`), mas isso só cobre sobreposição de **outra contratação já confirmada** — não cobre o suplente simplesmente não querer mais aquele trabalho por outro motivo. Ele ainda pode recusar quando for selecionado via "Retomar vaga".
