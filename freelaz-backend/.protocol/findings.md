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

## Mapa do fluxograma × código (Etapa 5 — INSPECT)

> **Sessão de LEITURA pura (2026-10-20).** Nenhuma linha de código de produção foi escrita.
> Fonte dos nós: `Freelaz — Fluxograma.html` (raiz do repo). `Status ∈ {IMPLEMENTADO, PARCIAL,
> AUSENTE, N/A}`. **IMPLEMENTADO** exige as 4 evidências (schema + service + rota + teste);
> faltando uma, é **PARCIAL**. `N/A` = nó não se aplica ao estágio atual. Nenhuma decisão de
> produto foi tomada; a coluna "Decisão de produto pendente" **só lista perguntas**. Quando o
> código já implica uma resposta, ela é anotada como **"implícita no código: X"** (não como
> decisão tomada).

### 1. Schema Prisma — o que existe hoje (por área)

Modelos/enums existentes em `prisma/schema.prisma` (765 linhas; 45 declarações `model`/`enum`).

| Área | Modelos/enums existentes | Lacunas (AUSENTE) |
| ---- | ------------------------ | ----------------- |
| **Cadastro/onboarding** | `User` (documentType CPF/CNPJ, document único, name/tradeName, birthDate, email, phone, passwordHash, city/state, pixKey, asaasCustomerId, termsAcceptedAt, emailConfirmedAt, phoneConfirmedAt), `UserRoleAssignment` (role PROFISSIONAL/CONTRATANTE/ADMIN + status PENDENTE/ATIVO), `Session`, `AuthToken` (EMAIL_CONFIRM/PASSWORD_RESET), `IdentityVerification` (role, documentUrl, selfieUrl, status, rejectionReason, decidedById), `ProfessionalProfile` (bio, categories[], headline, region, availability[], referencePriceCents, softSkills[], resumeUrl, verificationStatus, reliabilityScore, ratingAverage, isInfluencer), `PortfolioItem` (FOTO/VIDEO), `WorkExperience`, `ContractorProfile`, `SocialAccount` (INSTAGRAM/FACEBOOK/TIKTOK, accessTokenEnc) | **Sem** model de **categorias** (categorias são `String[]` no perfil, sem tabela/seed); **sem** verificação de telefone ativa (coluna existe, provedor SMS/WhatsApp ausente) |
| **Vaga** | `JobPosting` (title, description, category, valueCents, status ABERTA/PREENCHIDA/EXPIRADA/CANCELADA, visibility PUBLICA/PRIVADA, targetProfessionalId, urgentBoost, startsAt, endsAt), `JobPostingStatus`, `JobPostingVisibility`, `JobBoost` (amountCents default 1000, providerPaymentId, status) | **Sem** campo de modalidade (freelance/CLT/prestadora) na vaga; **sem** endereço/coordenadas na vaga (check-in não checa distância); **sem** vínculo vaga↔plano CLT |
| **Candidatura** | `Application` (status PENDENTE/CONTRAPROPOSTA/SELECIONADO/SUPLENTE/DESISTIU), `ApplicationStatus`, `@@unique([jobPostingId, professionalId])`; convite direto = `JobPosting.visibility=PRIVADA` + `targetProfessionalId` | — (o modelo já cobre candidatura pública, convite direto e suplente) |
| **Contraproposta** | `Application.counterOfferValueCents`, `counterOfferBy` ("CONTRACTOR"/"PROFESSIONAL"), `agreedValueCents` | **Sem** tabela própria de histórico de ofertas (cada contraproposta sobrescreve a anterior — só o valor/estado atual persiste) |
| **Contratação** | `Hiring` (jobPostingId, applicationId único, jobTitle, professionalId, contractorId, grossValueCents, netValueCents, commissionBps, status String, providerPaymentId, openingCode, closingCode, closingCodeUsedAt, disputeOpen, completedAt) | — |
| **Chat** | `Chat` (hiringId único, status AGUARDANDO_PAGAMENTO/ABERTO/ENCERRADO, openedAt, closedAt, closeReason, lastMessageAt), `Message` (chatId, senderId, body, readAt), `ChatStatus` | **Sem** anexos de arquivo em mensagem; **sem** model de "digitando"/recibo além de `readAt` |
| **Códigos de turno** | `Hiring.openingCode`/`closingCode`/`closingCodeUsedAt`, `CodeAttempt` (kind OPENING/CLOSING, success, attemptedById) | — |
| **Cancelamento** | `Hiring.status=CANCELADO` + `Chat.closeReason` (String livre); política é código (`matchService.ts`) | **Sem** model/coluna de **motivo** estruturado, **origem** (contratante/profissional/sistema) ou **política aplicada** no cancelamento — hoje só o `reason` textual do ledger e `closeReason` do chat |
| **Avaliação** | `Evaluation` (hiringId, authorId, targetId, rating 1–5 com CHECK, comment), `@@unique([hiringId, authorId])` | **Sem** flag de "cega"; janela de 2h é constante no código (`evaluationService`), não coluna |
| **Financeiro** | `LedgerEntry` (type RETENCAO/LIBERACAO/REEMBOLSO/AJUSTE, amountCents, reason, createdBy), `LedgerEntryType`, `Payout` (hiringId único, amountCents, status PENDENTE/PROCESSANDO/CONCLUIDO/FALHOU, idempotencyKey, providerTransferId), `PayoutStatus`, `ChargeAttempt`; saldo/carteira são **calculados** (`walletService.ts`) | **Sem** tabela de saldo/extrato persistido (por decisão: saldo é sempre soma — não é lacuna) |
| **Admin** | `UserRole.ADMIN`, `IdentityVerification.decidedById`, `Dispute` (status EM_ANALISE/RESOLVIDA, resolution DEVOLUCAO_TOTAL/LIBERACAO_TOTAL/DIVISAO, splitPercentToProfessional, decisionNote, decidedById, decidedAt), `DisputeEvidence`, `Report` (category ABUSO/FRAUDE/NAO_COMPARECEU/OUTRO, priority, status), `ReportCategory`, `ReportStatus`, `CltPlan` (name, monthlyPriceCents, simultaneousCap, active) | **AUSENTE: model de Configurações Financeiras** (comissão/valor CLT/valor boost não têm tabela — comissão está fixa em `lib/commission.ts` = 1000 bps, boost em `DEFAULT_BOOST_PRICE_CENTS` = 1000); **sem** model de auditoria de log do admin (decidido por colunas `decidedById`) |
| **Notificações** | `Notification` (userId, type OPENING_CODE_GENERATED/CLOSING_CODE_GENERATED/PROPOSAL_RECEIVED/COUNTER_PROPOSAL_RECEIVED, title, body, payload, `dedupeKey` @unique, readAt, createdAt), `NotificationDelivery` (notificationId, channel IN_APP/EMAIL/WHATSAPP, status PENDING/SENT/FAILED/SKIPPED, attemptedAt/sentAt/error, @@unique[notificationId, channel]), `NotificationPreference` (userId, type, channel, enabled, @@unique[userId, type, channel]) — **Etapa 7 (Fase B)** | **PARCIAL** — in-app + e-mail implementados; **WhatsApp modelado mas sem provider (SKIPPED)**; só os 4 eventos do MVP (sem notificação de mensagem nova/pagamento/avaliação/repasse) |
| **Chargeback/webhook** (extra) | `AsaasEvent` (asaasEventId único, event, paymentId, externalReference, payloadHash, processingStatus), `ChargebackEvent` (state ATIVO/ENCERRADO, closedAt, closedReason, deadlineToSendDisputeDocuments...) | — |

### 2. Services (`src/services/`) — inventário por área

| Área | Arquivo | Funções exportadas (principais) | O que faz |
| ---- | ------- | ------------------------------- | --------- |
| Cadastro/auth | *(sem service)* — lógica nas rotas `src/app/api/auth/*` + `src/lib/auth.ts`, `src/lib/document.ts` | `requireUser`, `hasActiveRole`, `validateDocument`... | Sessão, papéis, validação CPF/CNPJ |
| Vaga/candidatura | `jobPostingService.ts` | `selectCandidate`, `listSubstitutes`, `reopenJobPosting` | Seleção→Hiring, suplentes filtrados por agenda, reabrir vaga |
| Contratação | `hiringService.ts` | `createHiringForApplication`, `setHiringStatus`, `lockHiringForUpdate`, `hasActiveHiring`, `canTransitionHiring`, `ACTIVE_HIRING_STATUSES` | Máquina de estados do `Hiring` (único ponto autorizado) |
| Chat | `chatService.ts` | `chatStatusForHiring`, `syncChatToHiringStatus` | Chat derivado do status do Hiring (sem estado próprio) |
| Códigos | `codeService.ts` | `generateOpeningCodesDue`, `generateClosingCodesDue`, `markOpeningCodeUsed`, `markClosingCodeUsed`, `isEvaluationUnlocked`, `MAX_CODE_ATTEMPTS` | Geração/uso dos códigos, limite de tentativas |
| Cancelamento | `matchService.ts` | `cancelHiring` | Caminho único de encerramento antes da conclusão (reembolso+reabre) |
| Avaliação | `evaluationService.ts` | `createEvaluation`, `evaluationUnlockAt` | Avaliação mútua (janela 2h pós código de fechamento) |
| Confiabilidade | `reliabilityService.ts` | `refreshProfessionalReliability` | % de conclusões limpas (últimas 20) |
| Check-in | `checkInService.ts` | `haversineMeters`, *(registro de check-in)* | Evidência de início (não bloqueia código) |
| Ledger | `ledgerService.ts` | `recordRetention`, `recordRelease`, `recordRefund`, `computeRetainedBalance`, `getRetainedBalance`, `getTotalRetainedOnPlatform` | Livro-razão append-only |
| Pagamento | `chargeService.ts` | `ensureCharge`, `checkPersistedCharge`, `ensureAsaasCustomerForUser` | Criação idempotente de cobrança Pix (reconcilia antes) |
| Repasse | `payoutService.ts` | `releasePayout`, `releasePayoutManually`, `processPendingPayouts`, `payoutBlockReason` | Transferência Pix de saída + guardas (disputa/chargeback/avaliação) |
| Carteira | `walletService.ts` | `getProfessionalWallet*` | Saldo calculado (a receber/disponível/processando/sacado) |
| Reconciliação | `reconciliationService.ts` | `runReconciliation` | 5 invariantes; somente leitura |
| Disputa | `disputeService.ts` | `openDispute`, `addDisputeEvidence`, `resolveDispute` | Canal de controvérsia + decisão auditada (move dinheiro via ledger) |
| Denúncia | `reportService.ts` | `createReport`, *(listagem/decisão)* | Fila separada; nunca move dinheiro |
| Webhook/chargeback | `asaasEventService.ts` | `processAsaasEvent` (e `closeChargebackOnVerifiedOutcome`, `chargebacksBlockingPayout`, `hasActiveChargeback`) | Processa evento do Asaas; D6=A2 |
| Escalonamento | `chargebackEscalationService.ts` | `escalateChargebacksNearDeadline` | Lê chargebacks perto do prazo (somente leitura) |
| **AUSENTES** | — | — | **Sem service de**: notificação, config admin (financeira), "me contrate" separado (é a rota `jobs/invite` + `jobPostingService`), boost (lógica nas rotas `jobs/boost` + `chargeService`), categorias |

### 3. Rotas API (`src/app/api/`) — inventário por área

64 rotas `route.ts` encontradas. Por área:

| Área | Rotas existentes |
| ---- | ---------------- |
| Auth/cadastro | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET|POST /auth/roles`, `GET /auth/confirm`, `POST /auth/password/forgot`, `POST /auth/password/reset` |
| Perfil | `GET|PUT /profile/professional`, `GET|PUT /profile/contractor`, `GET /uploads/[...path]` |
| Verificação | `POST /verification/professional`, `POST /verification/contractor` |
| Vaga | `GET|POST /jobs`, `GET|PATCH|DELETE /jobs/[id]`, `POST /jobs/boost`, `POST /jobs/invite`, `GET /jobs/[id]/applications`, `POST /jobs/[id]/apply`, `GET|POST /jobs/[id]/resume`, `POST /jobs/[id]/select` |
| Candidatura/contraproposta | `GET /applications`, `POST /applications/[id]/counter-offer`, `POST /applications/[id]/respond` |
| Contratação | `GET /hirings`, `GET /hirings/[id]`, `POST /hirings/[id]/cancel` |
| Chat | `GET /hirings/[id]/chat`, `POST /hirings/[id]/chat/messages` |
| Códigos | `POST /hirings/[id]/codes` |
| Check-in | `POST /hirings/[id]/check-in` |
| Disputa | `POST /hirings/[id]/dispute`, `POST /hirings/[id]/dispute/evidence` |
| Avaliação | `POST /evaluations` |
| Denúncia | `POST /reports` |
| Pagamento/financeiro | `POST /payments/create`, `GET /wallet`, `POST /wallet/withdraw`, `POST /payouts/release` |
| Jobs (agendador) | `POST /jobs/opening-codes/run`, `/jobs/closing-codes/run`, `/jobs/weekly-payout/run`, `/jobs/daily-reconciliation/run`, `/jobs/chargeback-escalation/run` |
| Crons (legado) | `POST /cron/shift-codes`, `/cron/payouts`, `/cron/reconciliation` |
| Admin | `GET /admin/verifications`, `POST /admin/verifications/[id]/approve`, `POST /admin/verifications/[id]/reject`, `GET /admin/disputes`, `POST /admin/disputes/[id]/resolve`, `GET /admin/reports`, `POST /admin/reports/[id]/resolve`, `GET /admin/hirings`, `GET /admin/ledger`, `GET /admin/payouts`, `POST /admin/payouts/run-batch`, `POST /admin/payouts/[id]/release-manual`, `GET /admin/reconciliation`, `GET /admin/chargebacks`, `GET /admin/chargebacks/blocked` |
| Webhook | `POST /webhooks/asaas` |
| **AUSENTES** | **Sem rota de**: notificação, chat em tempo real (WebSocket/SSE), config financeira admin, categorias |

### 4. Testes (`.tools/`) — cobertura por área

| Arquivo | Escopo (seções) |
| ------- | --------------- |
| `test-fase1.ps1` | Auth/cadastro/perfil/verificação (15 seções) |
| `test-fase1b.ps1` | Confirmação de e-mail, reset de senha (A–H) |
| `test-fase1c.ps1` | CNPJ, aprovação manual, "Me contrate", contraproposta, suplentes, boost (A–L) |
| `test-fase2.ps1` | Publicação de vaga, marketplace, edição/cancelamento, candidaturas, seleção→Hiring, pagamento→chat, contraproposta, suplentes (§0–§8) |
| `test-fase3.ps1` | Carteira, códigos de turno, saque instantâneo, repasse semanal, reconciliação, travas (§0–§7) |
| `test-fase4.ps1` | Webhook Asaas real, check-in, limite de código, cancelamento, 3 disputas, gate de avaliação, denúncias, concorrência (§0–§11) |
| `test-fase5.ps1` | Autorização admin, fila de identidade, aprovação/rejeição, consultas, reconciliação, lote, disputa/denúncia pela sessão (§0–§13) |
| `test-idempotencia.mjs/.ps1` | 11–12 cenários de idempotência de cobrança (mock Asaas) |
| `test-chargeback.mjs/.ps1` | 10 seções (auth, durabilidade, chargeback, bloqueio, D6=A2) |
| `test-jobs.mjs/.ps1` | 7 seções (jobs + D8=A2) |
| `test-chat.mjs/.ps1` | 7 seções (bloqueio pré-pagamento, ABERTO pós-pagamento, envio/leitura, autorização, pós-cancelamento, sync de status, X4→X5) |
| `test-evaluation.mjs/.ps1` | 8 seções (janela 2h, libera após, unicidade por autor, média, faixa de rating, comentário, autorização, exposição da média) |
| `test-notifications.mjs/.ps1` | 9 seções (CRUD, marcar lida, preferência por canal, idempotência por `dedupeKey`, e-mail capturado via `EMAIL_TRANSPORT=json`, WhatsApp=SKIPPED, `readAt` do chat, eventos reais de código, proposta/contraproposta) |
| **AUSENTE** | **Sem teste de**: config admin (AD1) |

### 4b. Comportamento real de chat e avaliação (Etapa 6 — Fase A, INSPECT)

> Registro do **comportamento que existe hoje** (não do que deveria ser), para ancorar os testes HTTP da Etapa 6 — Fase A. Evidência por arquivo.

**Chat (P4).** O chat **não tem estado próprio**: `chatService.chatStatusForHiring` (`src/services/chatService.ts:16-30`) deriva `Chat.status` do status da contratação — `RETIDO | EM_ANDAMENTO | CONCLUIDO | EM_DISPUTA → ABERTO`; `CANCELADO | LIBERADO → ENCERRADO`; `AGUARDANDO_PAGAMENTO` (default) → `AGUARDANDO_PAGAMENTO`. `syncChatToHiringStatus` (idempotente) cria o chat sob demanda e só grava `openedAt`/`closedAt`/`closeReason` na primeira transição. **Acesso:** só as duas partes — `requireHiringParticipant` (`src/lib/hiringAccess.ts:35+`) devolve **403** para terceiro. **`GET /api/hirings/[id]/chat`** (`chat/route.ts`) exige participante, cria o chat se não existir e devolve `chat.status` + histórico paginado por cursor (`before`, `limit` ≤ 200, ordem cronológica) com `mine` calculado pela sessão; **enquanto `AGUARDANDO_PAGAMENTO` o histórico vem vazio por definição** (não é 403). **`POST /api/hirings/[id]/chat/messages`** (`chat/messages/route.ts`) exige participante, valida `body` de 1..2000 chars (**422** se vazio/longo) e **só aceita com `chat.status === "ABERTO"`**, senão **409** ("O chat é liberado depois que o pagamento for confirmado" / "Esta conversa foi encerrada"); o autor vem **sempre da sessão** (`user.id` — não há `senderId` no corpo), grava `Message` + atualiza `Chat.lastMessageAt` em transação e re-sincroniza o status ao final. **`readAt`: NÃO existe rota de "marcar como lida"** — `readAt` só é **lido** (`chat/route.ts:69`, `chat/messages/route.ts:81`), nunca escrito; hoje permanece `null`. **Após cancelamento** o chat vira `ENCERRADO` (mensagens históricas continuam legíveis pelo `GET`; novo envio → **409**).

**Avaliação (X7/AV1).** `evaluationService.createEvaluation` (`src/services/evaluationService.ts:22-90`) valida `rating` inteiro 1..5 (senão `Error`), `comment` ≤ 500 chars (`null` se vazio após trim), exige que o autor seja `contractorId` ou `professionalId` (senão `Error` "Você não participa…"), exige `status ∈ {CONCLUIDO, LIBERADO}` e `closingCodeUsedAt` presente, e **libera só após `closingCodeUsedAt + 2h`** (`EVALUATION_WINDOW_MS` = 2h, constante). Cada parte avalia **uma vez** por contratação: `@@unique([hiringId, authorId])`; a 2ª tentativa do mesmo autor cai em `P2002 → Error` "Você já avaliou esta contratação". Ao criar, atualiza `ratingAverage` do alvo (média de todas as avaliações recebidas, recalculada na **mesma transação**) em `professionalProfile` **e** `contractorProfile`. **`POST /api/evaluations`** (`evaluations/route.ts`) usa `requireUser`, **mapeia TODO erro do serviço para 400** (não há 409/403 distintos). Existe `listEvaluationsReceived` no serviço, mas **não há rota de leitura** — a média é exposta por `ratingAverage` no perfil. **`reliabilityService` é métrica separada** (a avaliação não toca confiabilidade).

### 4c. Resultado dos testes HTTP de chat e avaliação (Etapa 6 — Fase A)

**Cobertura adicionada** (nenhuma linha de `src/`/`prisma/` tocada — só `.tools/`):
- `test-chat.mjs`/`test-chat.ps1` — 7 seções, **61 OK / 0 FALHA**.
- `test-evaluation.mjs`/`test-evaluation.ps1` — 8 seções, **48 OK / 0 FALHA**.
- `run-all-tests.ps1` passou a rodar `11/12 = test-chat` e `12/12 = test-evaluation`.

**Comportamentos confirmados (observados, não assumidos):**
- Chat: `AGUARDANDO_PAGAMENTO` → GET 200 com histórico vazio e POST **409** ("O chat é liberado depois que o pagamento for confirmado"); após `PAYMENT_CONFIRMED` → `ABERTO` com `openedAt`; envio cria `Message` com autor da **sessão** (`senderId` do corpo é **ignorado**); terceiro recebe **403** no GET e no POST; cancelar → `ENCERRADO` com histórico **legível** e envio **409** ("Esta conversa foi encerrada"); `RETIDO→EM_ANDAMENTO→CONCLUIDO` mantém o chat `ABERTO` (só encerra em CANCELADO/LIBERADO).
- Avaliação: antes da janela de 2h → **400**; sem `closingCodeUsedAt` → **400**; após a janela → **201**; 2ª avaliação do mesmo autor → **400** ("Você já avaliou esta contratação"), índice único `(hiringId, authorId)` confirmado no banco; outro lado ainda avalia; `ratingAverage` do `professionalProfile` e do `contractorProfile` = média real; rating 0/6/-1/4.5 → **400**; comentário ausente/em branco → `null`, com texto → **trim**; > 500 chars → **400**; terceiro → **400** ("Você não participa…"); sem sessão → **401**; `ratingAverage` **exposto** em `GET /api/profile/professional`.

**Bugs encontrados:** nenhum. Todo o comportamento observado coincide com o mapa desta seção. As lacunas remanescentes de chat/avaliação são **limitações de produto** já registradas na tabela mestre (`readAt` nunca marcado; sem avaliação cega; sem rota de leitura de avaliações) — **não são bugs**.

### 4d. Notificações (Etapa 7 — Fase B, IMPLEMENTADO)

> Registro do que foi **construído e observado** na Etapa 7 — Fase B: canal de notificação multi-canal para os **4 eventos do MVP** + resolução da limitação de `Message.readAt`.

**1. Inventário do transporte de e-mail (INSPECT, antes de implementar).** NÃO existia `src/lib/email.ts` nem qualquer biblioteca de e-mail no `package.json` (sem `nodemailer`/`resend`/`sendgrid`/`mailgun`/`postmark`). `AuthToken.EMAIL_CONFIRM` (e `PASSWORD_RESET`) eram gerados em `src/app/api/auth/register/route.ts:144` e `src/app/api/auth/password/forgot/route.ts:25`, mas **nenhum transporte os enviava**: em `NODE_ENV !== "production"` o token saía apenas no **console** (`console.log("[Freelaz] Token de confirmação...")`) — comentário no próprio código dizia "nenhum provedor de e-mail está configurado ainda". Logo a Etapa 7 **criou o primeiro transporte real** (`src/lib/email.ts`, `nodemailer`).

**2. Canais suportados.** **IN_APP** (a notificação já vive no banco/API — entrega `SENT` imediata) e **EMAIL** (`nodemailer`; seleção de transporte: `NODE_ENV=test` **ou** `EMAIL_TRANSPORT=json` → `jsonTransport` (não sai pela rede; o JSON é anexado a `EMAIL_CAPTURE_FILE` para os testes); `SMTP_HOST` definido → SMTP real; **nenhum** → `SKIPPED` com `console.warn` e **nunca lança**). **WHATSAPP** fica **modelado** (`NotificationChannel.WHATSAPP`) **sem provider**: o dispatch grava `NotificationDelivery` com `status = SKIPPED` e `error = "channel_not_implemented"` — nenhum `fetch`, SDK ou credencial de WhatsApp. **Regra de ouro:** falha de e-mail **nunca** derruba a operação principal (vira `FAILED`/`SKIPPED`); o `to` só aparece **mascarado** no log (`us***@dominio`), nunca o conteúdo da mensagem.

**3. Os 4 eventos (decisão humana) e idempotência.** `OPENING_CODE_GENERATED` (X1; destinatário = profissional), `CLOSING_CODE_GENERATED` (X3; contratante), `PROPOSAL_RECEIVED` (convite; profissional-alvo) e `COUNTER_PROPOSAL_RECEIVED` (contraproposta; o **outro lado**). Toda emissão traz um **`dedupeKey`** (`@unique` em `Notification`): `opening_code:{hiringId}`, `closing_code:{hiringId}`, `proposal:{applicationId}`, `counter:{applicationId}:{side}`. Reemissão do mesmo evento devolve a notificação existente e **não redispara** — a proteção **não depende** de a operação nunca duplicar (P2002 tratado devolve a linha vencedora). Os hooks (`codeService.generateOpeningCodesDue`/`generateClosingCodesDue`, `POST /jobs/invite`, `POST /applications/[id]/counter-offer`) são **try/catch**: erro de notificação apenas loga aviso e a operação segue.

**4. `readAt` do chat resolvido.** Antes, `Message.readAt` só era **lido**, nunca escrito (não havia rota de "marcar como lida" — limitação da Etapa 6). A Etapa 7 adicionou `chatService.markMessagesRead(hiringId, userId)` + `PATCH /api/hirings/[id]/chat/messages/read` (só participante; terceiro **403**, sem sessão **401**): marca `readAt` de todas as mensagens onde `senderId !== userId` **e** `readAt IS NULL`, devolvendo `{ marked }`. O autor nunca marca a própria mensagem. **Não** notifica o remetente (feature posterior).

**5. Testes e contagem.** `test-notifications.mjs`/`test-notifications.ps1` — **9 seções, 70 OK / 0 FALHA**; integrado a `run-all-tests.ps1` como passo **13/13**. **Bugs encontrados:** nenhum. Comportamentos observados: `GET /notifications` devolve `{ notifications, unreadCount }` e só as do usuário da sessão; `PATCH /notifications/[id]/read` de alheia → **404**; `POST /notifications/read-all` zera `unreadCount`; desligar EMAIL por preferência grava `SKIPPED` (`disabled_by_preference`) e mantém IN_APP `SENT`; e-mail capturado contém destinatário/to, o código e o nome da vaga; 2ª execução do job de abertura → 1 notificação e 1 delivery (não redispara).

### 5. Tabela mestre — nó do fluxograma × código

| Nó | Descrição | Schema | Service | Rota | Teste | Status | Lacuna | Decisão de produto pendente |
| -- | --------- | ------ | ------- | ---- | ----- | ------ | ------ | --------------------------- |
| **A** | Cadastro único CPF ou CNPJ | `User` (documentType, document único) | — (rota) | `POST /auth/register` | fase1 §2/§5, fase1c A | **IMPLEMENTADO** | — | — |
| **B** | Dados básicos (nome/razão, e-mail, telefone) | `User.name`/`tradeName`/`email`/`phone` | — (rota) | `POST /auth/register` | fase1 §2/§4 | **IMPLEMENTADO** | Telefone não é verificado (só coluna) | Verificação de telefone: e-mail basta hoje? |
| **C** | "O que você quer fazer?" (papéis) | `UserRoleAssignment`, `UserRole` | `lib/auth` | `GET|POST /auth/roles` | fase1 §11, fase1c D | **IMPLEMENTADO** | — | — |
| **D** | Onboarding profissional (categorias, portfólio) | `ProfessionalProfile` (categories[], portfolio via `PortfolioItem`) | — (rota) | `GET|PUT /profile/professional` | fase1 §8 | **PARCIAL** | Sem tabela/seed de **categorias** (é `String[]` livre); sem rota própria de portfólio (só via perfil) | Categorias: lista fixa pelo admin ou texto livre? Portfólio tem limite/tamanho? |
| **E** | Onboarding contratante | `ContractorProfile` | — (rota) | `GET|PUT /profile/contractor` | fase1 §12 | **IMPLEMENTADO** | — | — |
| **F** | Verificação documento + selfie | `IdentityVerification`, `VerificationStatus` | — (rota + admin) | `POST /verification/professional`, `POST /admin/verifications/[id]/{approve,reject}` | fase1 §10, fase5 §2/§4/§5 | **IMPLEMENTADO** | Storage local em disco (produção precisa S3/R2) | — |
| **G** | Verificação leve (e-mail/telefone) | `User.emailConfirmedAt`/`phoneConfirmedAt` | — | `GET /auth/confirm` | fase1b B/C | **PARCIAL** | Telefone não confirmável (sem SMS/WhatsApp) | "Selo verificado" exige só e-mail por enquanto? |
| **H** | Home | *(sem persistência)* | — | — | — | **AUSENTE** | Sem tela/rota de home (front não existe; protótipo visual ausente) | Frontend: qual stack/telas? (protótipo não está na máquina) |
| **H1** | Feed de vagas freelance perto de você | `JobPosting` (+city/state no `User`) | `jobPostingService` | `GET /jobs` (filtros) | fase2 §2 | **PARCIAL** | "Perto de você" não é geográfico — sem coordenadas na vaga, filtro é por texto/cidade | Ordenação por proximidade real (GPS) ou por cidade? |
| **H2** | Abas: Freelance / CLT / Prestadoras | `JobPosting.category`; `CltPlan` existe mas sem vínculo a vaga | — | `GET /jobs` (filtro category) | fase2 §2 | **PARCIAL** | Sem modalidade na vaga; CLT/Prestadoras não são filtros reais (só categoria) | Como separar Freelance/CLT/Prestadoras? (campo novo na vaga? seções?) |
| **H3** | Toggle de modo (2 papéis ativos) | `UserRoleAssignment` | `lib/auth` `hasActiveRole` | `GET /auth/me` | fase1 §11 | **PARCIAL** | Sem endpoint de "modo ativo" — o front deriva dos papéis (não há estado de modo) | O "modo" é só visual ou muda filtros/permissões? |
| **V1** | Detalhe da vaga | `JobPosting` | `jobPostingService` | `GET /jobs/[id]` | fase2 §2 | **IMPLEMENTADO** | — | — |
| **V2** | Publicar vaga | `JobPosting` | `jobPostingService` | `POST /jobs` | fase2 §1 | **IMPLEMENTADO** | — | — |
| **V2a** | Publicar com urgência? R$10 | `JobBoost.amountCents` (=1000 fixo) | `chargeService` | `POST /jobs/boost` | fase1c K/L, fase2 | **PARCIAL** | R$10 **fixo no código** (`DEFAULT_BOOST_PRICE_CENTS`); sem config editável | Boost: R$10 fixo ou variável (editável pelo admin)? |
| **V2b** | Checkout do boost | `JobBoost`, `ChargeAttempt` | `chargeService` | `POST /jobs/boost` | fase1c, test-idempotencia | **IMPLEMENTADO** | — | — |
| **V3** | Vaga publicada (ABERTA) | `JobPosting.status=ABERTA` | `jobPostingService` | `POST /jobs` | fase2 §1 | **IMPLEMENTADO** | — | — |
| **V4** | Candidatar-se | `Application` (PENDENTE) | — (rota) | `POST /jobs/[id]/apply` | fase2 §4 | **IMPLEMENTADO** | — | — |
| **V5p** | "Me contrate" (perfil do profissional) | — (ponto de entrada) | — | — | — | **PARCIAL** | O botão inicia em `POST /jobs/invite`; não há tela/perfil público dedicado | Onde fica o botão? no perfil do profissional? |
| **V5** | Gera vaga PRIVADA só para o profissional | `JobPosting.visibility=PRIVADA`, `targetProfessionalId`; `Application` criada | `jobPostingService` | `POST /jobs/invite` | fase1c F | **IMPLEMENTADO** | Vaga privada não é escondida nas listagens? (verificar filtro visibility) | A vaga privada deve ser invisível ao marketplace? |
| **V5n** | Profissional decide (aceita/recusa/contraproposta) | `Application.status`, `counterOfferBy` | — (rota) | `POST /applications/[id]/respond`, `POST /applications/[id]/counter-offer` | fase1c G/J | **IMPLEMENTADO** | — | — |
| **V5c** | Nova oferta de valor | `Application.counterOfferValueCents`/`counterOfferBy` | — (rota) | `POST /applications/[id]/counter-offer` | fase1c G | **PARCIAL** | Sem **histórico** de ofertas (sobrescreve); sem limite de rodadas | Limite de rodadas de contraproposta? Histórico é necessário? |
| **V5n2** | Empresa decide (aceita/recusa/nova oferta/desiste) | `Application` | `jobPostingService` | `POST /applications/[id]/respond`, `POST /applications/[id]/counter-offer` | fase1c J | **IMPLEMENTADO** | — | — |
| **V5end** | Vaga privada encerrada | `Application.status=DESISTIU` | — | `POST /applications/[id]/respond` | fase1c | **PARCIAL** | Vaga privada recusada não muda `JobPosting.status` (fica ABERTA/PRIVADA órfã) | Vaga privada recusada deve virar CANCELADA? |
| **V6** | Lista de candidaturas | `Application` | `jobPostingService` | `GET /jobs/[id]/applications`, `GET /applications` | fase2 §4 | **IMPLEMENTADO** | — | — |
| **V7** | Empresa seleciona um candidato | `Application.status=SELECIONADO` | `selectCandidate` | `POST /jobs/[id]/select` | fase2 §5, fase4 §11 | **IMPLEMENTADO** | — | — |
| **V8** | Demais viram SUPLENTES | `ApplicationStatus.SUPLENTE` | `selectCandidate` | `POST /jobs/[id]/select` | fase2 §5/§8 | **IMPLEMENTADO** | — | — |
| **P1** | Checkout (Asaas, não mais MP) | `Hiring`, `ChargeAttempt` | `chargeService` | `POST /payments/create` | fase1c L, test-idempotencia | **IMPLEMENTADO** | — (fluxograma diz "Mercado Pago" — já migrado p/ Asaas) | — |
| **P2** | Pagamento aprovado? | `AsaasEvent`, `Hiring.status`, `LedgerEntry` (RETENCAO) | `asaasEventService`, `ledgerService` | `POST /webhooks/asaas` | fase4 §1/§1b | **IMPLEMENTADO** | — | — |
| **P3** | Vaga some do marketplace (PREENCHIDA) | `JobPosting.status=PREENCHIDA` | `asaasEventService` | `POST /webhooks/asaas` | fase4 | **IMPLEMENTADO** | — | — |
| **P4** | Chat desbloqueia | `Chat.status=ABERTO` | `chatService.syncChatToHiringStatus` | `GET /hirings/[id]/chat`, `POST /hirings/[id]/chat/messages`, `PATCH /hirings/[id]/chat/messages/read` | fase2 §6, fase3, test-chat §1–§7, test-notifications §7 | **IMPLEMENTADO** | Sem flag de **anexos** nem tempo real (`readAt` **agora é escrito** — Etapa 7; sobram as decisões 5–6) | Chat: tempo real ou polling? mensagens persistem após cancelamento? (implícita no código: persistem como histórico — chat vira ENCERRADO) |
| **X1** | 1h antes: código de abertura gerado | `Hiring.openingCode`, `Notification(OPENING_CODE_GENERATED)` | `codeService.generateOpeningCodesDue` → `notificationService.notifyAndDispatch` | `POST /jobs/opening-codes/run`, `GET /notifications` | fase3 §3, test-jobs, test-notifications §3–§5/§8 | **IMPLEMENTADO** | **Notificação entregue** (in-app + e-mail; WhatsApp modelado = SKIPPED) — Etapa 7. Provider de WhatsApp/push ainda ausente | Como o profissional recebe o código além de e-mail/in-app? (push/WhatsApp/SMS — fase posterior) |
| **X2** | Trabalho em andamento | `Hiring.status=EM_ANDAMENTO` | `markOpeningCodeUsed` | `POST /hirings/[id]/codes` | fase3 §3 | **IMPLEMENTADO** | Check-in não impede nem valida (só evidência) | Check-in é obrigatório para iniciar? |
| **X3** | 1h antes do fim: código de fechamento | `Hiring.closingCode`, `Notification(CLOSING_CODE_GENERATED)` | `codeService.generateClosingCodesDue` → `notificationService.notifyAndDispatch` | `POST /jobs/closing-codes/run`, `GET /notifications` | fase3 §3, test-jobs, test-notifications §8 | **IMPLEMENTADO** | **Notificação entregue** ao contratante (in-app + e-mail) — Etapa 7; WhatsApp/push ainda ausente | (mesma pergunta de X1) |
| **X4** | Código de fechamento confirmado pela empresa? | `Hiring.closingCodeUsedAt`, `CodeAttempt` | `markClosingCodeUsed` | `POST /hirings/[id]/codes` | fase4 §3 | **IMPLEMENTADO** | Sem caminho alternativo se a empresa sumir (vai para disputa) | E se a empresa não confirmar? timeout → disputa? |
| **X5** | Serviço concluído | `Hiring.status=CONCLUIDO`, `completedAt` | `setHiringStatus` | `POST /hirings/[id]/codes` | fase3 §3 | **IMPLEMENTADO** | — | — |
| **X6** | Cancelamento (caminho único) | `Hiring.status=CANCELADO`, `LedgerEntry.REEMBOLSO` | `matchService.cancelHiring` | `POST /hirings/[id]/cancel` | fase4 §4 | **PARCIAL** | Sem coluna de **motivo/origem** estruturado (só `reason` textual); política de multa não implementada (só reembolso 100%) | Multas existem? origem (contratante/profissional/sistema) deve ser persistida? |
| **R1** | Vaga reabre ("Retomar vaga") | `JobPosting.status=ABERTA` | `reopenJobPosting` | `GET /jobs/[id]/resume` | fase2 §8 | **IMPLEMENTADO** | — | — |
| **R2** | Filtra suplentes por conflito de agenda | `Application` + `Hiring` (overlap startsAt/endsAt) | `listSubstitutes` | `GET /jobs/[id]/resume` | fase2 §8 | **IMPLEMENTADO** | Só cobre sobreposição de contratação confirmada | Suplente é notificado automaticamente ou a empresa reescolhe? |
| **X7** | 2h depois: avaliação libera | `Hiring.closingCodeUsedAt` (janela 2h) | `evaluationService.evaluationUnlockAt`, `isEvaluationUnlocked` | `POST /evaluations` | fase4 §6 | **PARCIAL** | Janela 2h é constante no código; avaliação não testada via HTTP ponta a ponta | Janela de 2h está fechada? timeout máximo para avaliar? |
| **AV1** | Avaliação mútua (1–5 + comentário) | `Evaluation` (rating, comment, unique por hiring+author) | `evaluationService.createEvaluation` | `POST /evaluations` | fase4 §6, test-evaluation §1–§8 | **IMPLEMENTADO** | Sem flag de **cega** (**limitação de produto**: decisão 8); sem rota de **leitura** de avaliações (só `POST`) — média (`ratingAverage`) exposta no perfil (**limitação de produto**: decisão 10) | Avaliação é **cega** (só revela quando os dois avaliam)? média exibida onde? |
| **FN1** | Saldo liberado (LedgerEntry) | `LedgerEntry.LIBERACAO` | `ledgerService.recordRelease` | `POST /payouts/release` | fase3 §5/§7 | **IMPLEMENTADO** | — | — |
| **FN2** | Repasse Pix ao profissional | `Payout`, `providerTransferId` | `payoutService.releasePayout`/`processPendingPayouts` | `POST /payouts/release`, `/jobs/weekly-payout/run` | fase3 §5 | **IMPLEMENTADO** | Produção pendente (chave real + 1 transferência baixo valor) | — |
| **FN3** | Extrato / Carteira | *(calculado)* | `walletService` | `GET /wallet` | fase3 §1 | **PARCIAL** | Sem tela; taxa de saque é placeholder (100 bps) | Taxa do saque instantâneo: valor final? (hoje 1% placeholder) |
| **AD1** | Configurações financeiras (comissão, CLT, boost) | `CltPlan` existe; **comissão/boost fixos no código** | **AUSENTE** | **AUSENTE** | **AUSENTE** | **AUSENTE** | Sem tabela nem rota de config; comissão 10% e boost R$10 hardcoded | Quais valores são editáveis? plano CLT: faixas/valores? |
| **AD2** | Reconciliação diária | `LedgerEntry`, `AsaasEvent` | `reconciliationService.runReconciliation` | `POST /jobs/daily-reconciliation/run`, `GET /admin/reconciliation` | fase3 §6, fase5 §8 | **PARCIAL** | Relatório **stateless** (não persistido); painel consulta ao vivo | Guardar histórico da reconciliação? |
| **AD3** | Disputas e denúncias | `Dispute`, `DisputeEvidence`, `Report` | `disputeService`, `reportService` | `GET /admin/disputes`, `/admin/reports`, `POST .../resolve` | fase4 §5/§7/§8/§10, fase5 §10/§11 | **IMPLEMENTADO** | — | — |
| **WhatsApp** | Notificação (V.L.A.E.G. — Link) | `Notification`/`NotificationDelivery`/`NotificationPreference` + enum `NotificationChannel` | `notificationService.notifyAndDispatch`, `src/lib/email.ts` | `GET /notifications`, `PATCH /notifications/[id]/read`, `POST /notifications/read-all`, `GET/PUT /notification-preferences`, `PATCH /hirings/[id]/chat/messages/read` | test-notifications §1–§9 | **PARCIAL** | **In-app + e-mail** implementados (4 eventos, idempotência por `dedupeKey`, preferência por canal); **WhatsApp só MODELADO** (`NotificationChannel.WHATSAPP`, dispatch = SKIPPED `channel_not_implemented` — sem provider/SDK/credencial) | WhatsApp Business API: qual provedor? quais eventos além dos 4? push? |

### 6. Decisões de produto pendentes (para a próxima implementação)

> Lista **única** consolidada, agrupada por área e ordenada por **dependência** (o que trava o resto primeiro).
> **Nenhuma resposta aqui** — são perguntas.

**Bloqueiam várias áreas (decidir primeiro)**
1. **Frontend/telas:** qual stack e quais telas primeiro? (o protótipo visual `design-protótipo` **não está na máquina** — bloqueia Home H, V1, V5p, FN3 e todas as telas).
2. **Modalidade da vaga (H2/V3):** criar campo `modality` (Freelance/CLT/Prestadoras) na vaga? como CLT e Prestadoras se diferenciam no fluxo?
3. **Notificação (WhatsApp/canal):** qual provedor (WhatsApp Business API, e-mail, push)? quais eventos notificam (código de turno, nova vaga, proposta, contraproposta, avaliação, repasse)? o usuário escolhe canal?
4. **Configurações financeiras (AD1):** quais valores são editáveis pelo admin? comissão (hoje 10% fixo), valor do plano CLT (faixas? valores?), valor do boost (hoje R$10 fixo), taxa do saque instantâneo (hoje 1% placeholder)?

**Chat (P4)**
5. Chat em tempo real (WebSocket/SSE) ou polling?
6. Mensagens persistem após cancelamento? (implícita no código: viram histórico com `Chat.status=ENCERRADO`)
7. Anexos de arquivo ou só texto?

**Avaliação (X7/AV1)**
8. Avaliação é cega (só revela quando os dois avaliam)?
9. Janela de 2h está fechada? há timeout máximo para avaliar?
10. Onde a média (`ratingAverage`) é exibida?

**Categorias / portfólio (D)**
11. Categorias: lista fixa gerenciada pelo admin ou texto livre? (hoje `String[]` livre)
12. Portfólio: limite de itens/tamanho de mídia?

**Candidatura / contraproposta (V5c/V5end)**
13. Limite de rodadas de contraproposta? (hoje ilimitado, com sobrescrita)
14. Histórico de ofertas é necessário (hoje só o valor atual persiste)?
15. Vaga privada recusada deve virar CANCELADA (hoje fica ABERTA/PRIVADA órfã)?
16. A vaga privada ("Me contrate") deve ser invisível ao marketplace?

**Suplentes (R2)**
17. Suplente é notificado automaticamente ao reabrir a vaga, ou a empresa reescolhe manualmente?
18. Suplente que já não quer pode ser removido (hoje ele só recusa ao ser selecionado)?

**Cancelamento (X6)**
19. Existem **multas** por cancelamento? (hoje só reembolso 100%)
20. Persistir **motivo** e **origem** (contratante/profissional/sistema) estruturados?

**Turno (X2/X4)**
21. Check-in é obrigatório para iniciar o turno? (hoje só evidência)
22. E se a empresa não confirmar o código de fechamento (empresa some)? timeout → disputa automática?

**Home / descoberta (H1/H3)**
23. Ordenação por proximidade real (GPS) ou por cidade? (vaga não tem coordenadas hoje)
24. O "toggle de modo" é só visual ou muda filtros/permissões?

**Financeiro/admin (FN3/AD2)**
25. Guardar histórico da reconciliação diária (hoje stateless)?
26. Taxa do saque instantâneo: valor final confirmado? (hoje 1% placeholder)

**Verificação (B/G)**
27. O "selo verificado" de contratante exige só e-mail por enquanto (sem SMS)? quando entrar telefone, exigir os dois?

### 7. Ordem sugerida (Etapa 6+)

Sugestão de sequência (1 frase de justificativa cada; **não implementar**):

1. **Configurações financeiras editáveis (AD1)** — é dinheiro já em produção no código (comissão/boost hardcoded) e destrava decisão 4; sem tabela nova complexa.
2. **Notificação (WhatsApp/canal)** — **feito em parte na Etapa 7 — Fase B**: in-app + e-mail para os 4 eventos (X1/X3/proposta/contraproposta) já entregam; falta só o **provider de WhatsApp/push** e eventos adicionais.
3. **Chat** — já existe e tem **prova HTTP ponta a ponta** (Etapa 6 — Fase A); o `readAt` foi resolvido na Etapa 7; restam as decisões 5–6 (tempo real/anexos).
4. **Avaliação (X7/AV1)** — já existe e agora tem **prova HTTP ponta a ponta** (Etapa 6 — Fase A); faltam as decisões 8–10 (cega/janela/média).
5. **Cancelamento estruturado (X6)** — decisões 19–20 definem multas (mudam dinheiro) antes de qualquer código.
6. **Modalidade da vaga (H2)** + **suplentes (R2)** — dependem das decisões 2 e 17–18.
7. **Frontend/telas (H, V1, V5p, FN3)** — **bloqueado** por decisão 1 (protótipo visual ausente); por isso fica por último apesar de ser a face do produto.

**Áreas bloqueadas por quais decisões:**
- Frontend (H, V1, V5p, FN3) ← decisão **1**.
- Modalidade/CLT (H2, AD1) ← decisões **2** e **4**.
- Notificação (todos os avisos) ← decisão **3**.
- Chat (P4) ← decisões **5, 6, 7**.
- Avaliação (X7/AV1) ← decisões **8, 9, 10**.
- Cancelamento (X6) ← decisões **19, 20**.
- Suplentes (R2) ← decisões **17, 18**.
- Contraproposta (V5c/V5end) ← decisões **13, 14, 15, 16**.

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

## 4e. Etapa 7.1 — soft-hide wired (iFood)

- **Schema**: `Chat.hiddenAt DateTime?` em `prisma/schema.prisma`. Migração aditiva `20261020210000_etapa7_chat_hide/migration.sql` (`ALTER TABLE "Chat" ADD COLUMN "hiddenAt" TIMESTAMP(3);`), aplicada.
- **Job**: `POST /api/jobs/hide-concluded-chats/run` (`checkJobsToken`, log sem PII) executa `chatService.hideConcludedChats()`; schedule `*/15` em `.github/workflows/jobs.yml`. Oculta `Chat` quando `Hiring.status='CONCLUIDO'` **e** `completedAt <= now - 2h` **e** `hiddenAt IS NULL`.
- **Exceções**: não oculta se `Hiring.disputeOpen=true` OU existe `Dispute` com `status='EM_ANALISE'` OU `ChargebackEvent.state='ATIVO'`; cada motivo incrementa `skipped.dispute` / `skipped.chargeback`. Nunca deleta `Chat` nem `Message` — só preenche `hiddenAt`.
- **Visibilidade**: `getChatForUser(hiringId, userId, isAdmin)` devolve 404 (`{ error: 'Conversa não encontrada' }`) para não-admin quando `hiddenAt` está preenchido; `getChatForAdmin(hiringId)` **sempre** devolve (`chatId`, `hiddenAt`, mensagens), sem filtro de ocultação.
- **Rotas plugadas**: `GET /api/hirings/[id]/chat` e `POST /api/hirings/[id]/chat/messages` filtram por `getChatForUser` (404 antes da checagem de status no POST). `PATCH /api/hirings/[id]/chat/messages/read` marca `readAt` das mensagens recebidas e devolve `{ marked }`. `GET /api/admin/hirings/[id]/chat` usa `checkAdminAccess` e devolve `{ chatId, hiddenAt, messages }` mesmo com o chat oculto.
- **Testes**: `test-chat.mjs` §8–§11 (19 asserts: 5 readAt, 7 soft-hide, 4 disputa, 3 chargeback) rodam contra o dev server real + mock Asaas. Não há `skip`, `try/catch` nem `if (404) return` nessas seções: cada `check` falha o processo (`process.exit(1)`).
- **Correção da asserção §9**: o teste esperava `json.chat.hiddenAt`, mas o contrato do admin (desde `ca9cf4d`) é `json.hiddenAt` (top-level). A asserção foi alinhada ao contrato atual em 2026-10-21; não era um teste "passando por engano".

## 4f. Etapa 7.3a — fundação subcontas Asaas

Escopo desta etapa: **somente schema + helpers**, nenhum fluxo ligado. Onboarding (7.3b), split (7.3c) e payout via subconta (7.3d) ficam pendentes.

| item | status | arquivo |
|---|---|---|
| Campos `User.asaasSubaccountId` / `asaasSubaccountApiKey` / `asaasSubaccountStatus` | **feito** (nullable; status string livre) | `prisma/schema.prisma` |
| Migração aditiva | **feita** (`20261021150000_etapa73a_subcontas`) | `prisma/migrations/20261021150000_etapa73a_subcontas/migration.sql` |
| `POST /v3/accounts` | **feito** via `createAsaasSubaccount()` (não chamado em produção) | `src/lib/asaas.ts` |
| `GET /v3/accounts/{id}` | **feito** via `getAsaasSubaccount()` | `src/lib/asaas.ts` |
| `GET /v3/finance/balance` com chave da subconta | **feito** via `getAsaasSubaccountBalance()` (retorna `balance` + `balanceCents`) | `src/lib/asaas.ts` |
| Tipos exportados | `AsaasSubaccount`, `AsaasSubaccountPayload` (+ resultados `Create…Result`, `Get…Result`, `…BalanceResult`) | `src/lib/asaas.ts` |
| Feature flag | `ASAAS_SUBACCOUNT_ENABLED="false"` (default OFF) | `.env.example` |
| Onboarding / split / payout via subconta | **NÃO feito** (7.3b/c/d) | — |

### Período de avaliação regulatória

A doc oficial (consultada em 2026-10-21) avisa que **toda conta nova que cria subcontas via API entra no período de avaliação regulatória do Asaas**; durante esse período, operações de subcontas e cobranças ficam sujeitas a **limites iniciais**. Fonte: https://docs.asaas.com/docs/criacao-de-subcontas (callout "Atenção") e https://docs.asaas.com/docs/subcontas. Regras relevantes:

- A **conta-pai precisa ser pessoa jurídica (CNPJ)** — https://docs.asaas.com/reference/criar-subconta.
- O payload exige `name`, `email`, `cpfCnpj`, `mobilePhone`, `incomeValue`, `address`, `addressNumber`, `province`, `postalCode`; `postalCode` inválido devolve 400.
- A `apiKey` da subconta vem em `accessToken.apiKey` **somente na criação** e é irrecuperável depois (por isso o campo `asaasSubaccountApiKey`, nunca logado).
- `GET /v3/accounts/{id}` **não** devolve a `apiKey`.

### Bloqueios descobertos na inspeção

- **Conta principal do Sandbox é CPF (`personType=FISICA`, `companyType=null`)**, não CNPJ. Como a criação de subconta exige conta-pai PJ, **não é possível validar o fluxo de criação no Sandbox atual** — precisa de conta Sandbox PJ (ou validação em produção após o CNPJ da plataforma).
- `.env` local estava com um `\` antes da chave (`ASAAS_API_KEY="\$aact...`): o app recebia 401 `invalid_access_token` em qualquer chamada real. Corrigido localmente (arquivo é gitignored; backup em `.tools/tmp/.env.bak-73a`). Isto não afeta a bateria mock, que injeta a própria chave.
- **Próximo passo 7.3b**: endpoint de onboarding (feature flag `ASAAS_SUBACCOUNT_ENABLED`), persistência de id/apiKey/status, tratamento do período de avaliação e definição de qual documento (CPF do profissional vs CNPJ) vira subconta.

## 4g. Etapa 7.3b — onboarding de subconta Asaas (mock; Sandbox deferido)

Escopo: coletar endereço/renda no perfil do profissional e criar a subconta via **mock**. Nenhuma chamada ao Sandbox/produção; a feature flag continua `false` por padrão.

| item | status | arquivo |
|---|---|---|
| `User.postalCode` / `address` / `addressNumber` / `province` / `incomeValueCents Int?` | **feito** (nullable; MVP em `User`, sem `UserAddress` 1:N) | `prisma/schema.prisma` |
| Migração aditiva (13ª) | **feita e aplicada** (`20261022120000_etapa73b_endereco_subconta`) | `prisma/migrations/20261022120000_etapa73b_endereco_subconta/migration.sql` |
| `PUT /api/profile/professional` aceita os 5 campos | **feito** (opcionais; `postalCode` 8 dígitos normalizado, `incomeValueCents` inteiro > 0, demais não-vazios; ausência/vazio = null) | `src/app/api/profile/professional/route.ts` |
| `createSubaccountForUser(userId)` | **feito** (idempotente + validação de todos os campos) | `src/services/subaccountService.ts` |
| `POST /api/profile/subaccount` | **feito** (401/403/503/400/200) | `src/app/api/profile/subaccount/route.ts` |
| `POST /v3/accounts` + `GET /v3/accounts/{id}` no mock | **feito** (`apiKey` só no POST; GET não devolve) | `.tools/mock-asaas.mjs` |
| `test-subaccount.mjs` + `.ps1` | **feito** — 54 asserts (14 na fase OFF + 40 na fase ON), 6 seções | `.tools/test-subaccount.mjs` / `.tools/test-subaccount.ps1` |
| Bateria | passo **14/14** | `.tools/run-all-tests.ps1` |
| Onboarding real no Sandbox | **NÃO validado** (bloqueio CPF, abaixo) | — |

### Contrato implementado

- `createSubaccountForUser(userId): Promise<CreateSubaccountForUserResult>` — união `{ok:true, subaccountId, status, skipped}` | `{ok:false, missing}` | `{ok:false, error}`.
- **Idempotência**: se `User.asaasSubaccountId` já existe, devolve o id/status persistidos com `skipped:true` e **não** chama o provedor (a `apiKey` só existe na criação e é irrecuperável).
- **Campos exigidos**: `name`, `email`, `document`, `phone`, `postalCode`, `address`, `addressNumber`, `province`, `incomeValueCents` + `birthDate` (CPF) **ou** `tradeName` (CNPJ). Faltando → `400 {ok:false, missing:[...]}` sem chamar o provedor.
- **Erros**: 4xx do Asaas → `{ok:false, error}`; 5xx/rede → relança (resultado desconhecido, exige reconciliação).
- **Segredos**: `apiKey` só é persistida; `incomeValueCents` só é convertido para `incomeValue` (reais). Nenhum dos dois é logado ou devolvido na resposta.

### Sandbox CPF — validação deferred

A conta principal do Sandbox é **CPF** (`GET /v3/myAccount` → `personType=FISICA`), e subcontas exigem conta-pai **CNPJ**. Portanto a criação real **não foi validada**; o fluxo foi provado contra o mock. Mesmo padrão do chargeback: quando/se houver conta Sandbox PJ (ou CNPJ em produção), reenviar a validação real ao Asaas.

### Notas operacionais

- **`.env` com `$` não escapar**: a chave Asaas começa com `$aact_...`; em `.env`/shell é preciso cuidado para não tratar `$` como variável. O arquivo local estava com `\$` e causava 401; corrigido fora do git. Não usar `eval`/expansão ao ler a chave.
- **`incomeValueCents` é sensível**: é renda declarada. Não logar, não incluir em mensagens de erro e não expor em listagens públicas.
- **Bateria**: 1085 OK / 0 FALHA, `BATTERY_EXIT=0` (antes: 1031; +54 da 7.3b). Para rodar, `ASAAS_API_KEY` do `.env` fica vazia (guard 503) e é restaurada ao final.
- **Harness**: `Stop-Port` de `test-chargeback.ps1`, `test-jobs.ps1` e `test-idempotencia.ps1` passou a isolar o stderr do `taskkill` com `cmd /c` (mesmo padrão de chat/notificações), evitando que um processo-filho já morto abortasse a bateria. Não muda produto.

### Próximo passo 7.3c — split

Usar o `walletId` da subconta na cobrança (`chargeService`) para dividir entre plataforma e profissional. Hoje a cobrança é única, sem split; a 7.3b **não** plugou nenhum split/payout.

## 4h. Etapa 7.3c - split no chargeService (feature flag + fallback)

| item | status | arquivo |
|---|---|---|
| incomeValue no payload | confirmado: `incomeValueCents / 100` (reais), linha 118 | `src/services/subaccountService.ts` |
| PF (CPF) | envia name, email, cpfCnpj, mobilePhone, incomeValue, address, addressNumber, province, postalCode e birthDate | `src/services/subaccountService.ts` |
| PJ (CNPJ) | mesmos campos, SEM birthDate; `companyType` (opcional, enum Asaas) enviado quando preenchido; `tradeName` NAO e campo de POST /v3/accounts (ver 4i) | `src/services/subaccountService.ts` |
| `User.companyType` | feito (nullable; `MEI`/`LIMITED`/`INDIVIDUAL`/`ASSOCIATION`) | `prisma/schema.prisma` |
| `User.asaasSubaccountWalletId` | feito (nullable) | `prisma/schema.prisma` |
| `Hiring.asaasSplitId` | feito (nullable) | `prisma/schema.prisma` |
| `Payout.origin` | feito (`@default("MAIN")`, MAIN ou SUBACCOUNT) | `prisma/schema.prisma` |
| Migracao aditiva (14a) | feita e aplicada (`20261023120000_etapa73c_split`) | `prisma/migrations/20261023120000_etapa73c_split/migration.sql` |
| Migracao aditiva (15a) | feita e aplicada (`20261023130000_etapa73c1_company_type`) | `prisma/migrations/20261023130000_etapa73c1_company_type/migration.sql` |
| Persistencia do walletId na criacao | feito | `src/services/subaccountService.ts` |
| Split no `ensureCharge` | feito (somente HIRING; flag ON + subconta + walletId; 1 entrada) | `src/services/chargeService.ts` |
| Fallback | flag OFF, sem subconta ou valores invalidos -> payload sem split, `asaasSplitId=null` | `src/services/chargeService.ts` |
| Mock `POST /v3/payments` | aceita e ecoa `split`; valida wallet existente, 0 < percentual <= 100 e soma <= 100% | `.tools/mock-asaas.mjs` |
| Webhook | log `[webhook] split recebido hiring=<id>`; NAO move dinheiro | `src/app/api/webhooks/asaas/route.ts` |
| Testes | 14 OFF + 59 ON = 73 asserts, 0 falhas; ?7 split ON, ?7b guard, ?8 fallback, ?9 payout origin | `.tools/test-subaccount.mjs` |
| Bateria | 1104 OK / 0 FALHA, `BATTERY_EXIT=0` (ver 4i) | `.tools/run-all-tests.ps1` |

### Notas da 7.3c

- **walletId != subaccountId**: o split usa o `wallet_...` devolvido por POST /v3/accounts; `acc_...` identifica a subconta. Os dois sao persistidos.
- **Webhook so loga**: a divisao acontece na liquidacao do POST /payments; o webhook nao transfere dinheiro nem cria lancamento.
- **Taxa de saque da subconta**: quem paga? Pendencia de produto para a 7.3d.
- **Payout**: `Payout.origin` e apenas rastreamento; `payoutService` NAO foi alterado no fluxo (scaffold puro em 4i).

Proximo passo 7.3d: payout via subconta (decidir taxa de saque e origem do saldo).

## 4i. Etapa 7.3c.1 - semantica do split + PJ + scaffold 7.3d

### Semantica do split (fonte oficial)

Fonte: https://docs.asaas.com/docs/split-de-pagamentos (consultado em 2026-10-21).

> "Nao informe o `walletId` da conta que cria a cobranca. O valor liquido que nao for direcionado aos recebedores permanece automaticamente nessa conta."
>
> "Para Splits exclusivamente percentuais, a soma nao pode ultrapassar 100%."

**Conclusao:** uma unica entrada (`[{walletId: subconta, percentualValue: 90}]`) e VALIDA. Os 10% restantes permanecem na conta principal; enviar o wallet da principal seria proibido pela doc e nao e feito. O mock passou a rejeitar soma **> 100%** (nao `!= 100`), reproduzindo a doc.

### incomeValue

Fonte: https://docs.asaas.com/reference/criar-subconta (AccountSaveRequestDTO).

> `"incomeValue": { "type": "number", "description": "Faturamento/Renda mensal", "example": 25000 }`

**Conclusao:** o provedor espera **reais** (number), nao centavos. Mantido `incomeValue = incomeValueCents / 100`; o valor continua sem log.

### PJ (CNPJ)

Fonte: mesma reference (AccountSaveRequestDTO / AccountSaveRequestCompanyType).

- `companyType`: enum `MEI | LIMITED | INDIVIDUAL | ASSOCIATION`, opcional (somente PJ).
- `tradeName` **nao existe no request** de POST /v3/accounts; a resposta traz `tradingName` como "preenchido automaticamente". O guia de criacao tambem nao envia tradeName.

**Implementado:** `User.companyType String?` + migracao 15; `companyType` vai no payload somente para CNPJ e se preenchido (validado contra o enum). A exigencia local de `tradeName` foi REMOVIDA (ela bloqueava PJ e nao era enviada); `name` continua sendo a razao social. O mock valida/ecoa `companyType`.

### Guard de valores

`resolveHiringSplit` agora devolve `reason=invalid_values` (split OFF) quando `grossValueCents <= 0`, `netValueCents <= 0` ou `netValueCents > grossValueCents` - antes esse caso era rotulado como `no_subaccount`.

### Scaffold 7.3d

`payoutService.resolvePayoutOrigin(hiring)` e puro e **nao e chamado por nenhum fluxo**:

- flag `PAYOUT_FROM_SUBACCOUNT_ENABLED=false` (default) -> `MAIN`;
- flag ON + sem `hiring.professional.asaasSubaccountApiKey` -> `MAIN`;
- flag ON + apiKey existente -> `SUBACCOUNT`.

Nao move dinheiro nem grava `Payout.origin`.

### Limitacao conhecida (cosmetica, fora do escopo)

Se a criacao da cobranca com split tiver a resposta perdida, a adocao pela reconciliacao grava `providerPaymentId` mas **nao** `asaasSplitId` (o campo fica `null`). E rastreamento/auditoria; o split ja foi liquidado na origem e nada muda no dinheiro. TODO para a 7.3d.

### Testes

- `test-subaccount.mjs`: **14 OFF + 59 ON = 73 asserts / 0 falhas**; §7 split ON (1 entrada, 90%), §7b guard `net>gross`, §8 fallback, §9 `resolvePayoutOrigin` (3 casos).
- `mock-asaas.mjs`: valida wallet existente, `0 < percentual <= 100`, soma `<= 100`, e `companyType` no enum.
- Bateria completa: **1104 OK / 0 FALHA**, `BATTERY_EXIT=0` (Fases 1-5 = 597; Etapa 1+2 = 92; Etapa 3 = 99; Etapa 3.2 jobs = 45; chat = 80; avaliacao = 48; notificacoes = 70; subconta 14 OFF + 59 ON = 73). Contagem anterior (7.3c): 1098; +6 desta etapa. Sessao 26 em `progress.md`.
- **Harness**: o wrapper da bateria passou a redirecionar a saida direto para arquivo (`cmd /c "... > log 2>&1"`) em vez de `*>` (pipe). Com `*>`, o dev server iniciado pelos passos herda o handle e o pipe nunca recebe EOF, travando a bateria no passo 10 mesmo com os testes ja concluidos. O exit e gravado em arquivo imediatamente apos o `cmd /c`.

## 4j. Etapa 7.3d - modelo de taxa "empresa paga tudo" (custodia, sem subcontas)

Flag `TAX_MODEL_NEW` (default `false`). Com OFF nada muda: todo Hiring antigo e
novo nasce `LEGACY` e o comportamento historico permanece intocado. Com ON o
modelo novo vale para contratações NOVAS; as antigas continuam `LEGACY`.

### Regra por modelo

| item | LEGACY (historico) | NEW (empresa paga tudo) |
|---|---|---|
| `netValueCents` (profissional) | bruto - 10% | **bruto (100%)** |
| `serviceFeeCents` | null | `round(bruto * 0.10)` |
| `estimatedWithdrawalFeeCents` | null | `<= R$250` -> R$0,08; senao R$2,00 |
| `totalChargedCents` | null | bruto + serviceFee + estimated |
| cobranca no provedor | bruto | **totalCharged** |
| ledger no PAYMENT_CONFIRMED | 1x RETENCAO = bruto | RETENCAO = bruto + RECEITA_PLATAFORMA = taxas |
| `releasePayout` | liquido | **bruto** (saque manual desconta a taxa do profissional) |
| `walletService.disponivelCents` | liquido | **bruto** |

### Decisao

- O dinheiro continua em **custodia na conta principal** do Freelaz; **sem
  split e sem subcontas** nesta etapa (flags de subconta permanecem OFF).
- A comissao deixou de ser descontada do profissional no modelo NEW: ela e
  cobrada da empresa como `serviceFee`, junto da estimativa da taxa de saque.
- `RECEITA_PLATAFORMA` e receita da empresa, nao saldo retido: fica fora de
  `computeRetainedBalance` e nunca e repassada.
- O saque manual (`POST /api/wallet/withdraw`) NAO muda: o profissional
  continua pagando a taxa do saque instantaneo sobre o valor que recebe.
- `estimateWithdrawalFeeCents` e uma ESTIMATIVA (a taxa real do provedor so e
  conhecida no saque); `withdrawalFeeReal` e registrado no log do payout para
  conciliacao futura.

### Nota regulatoria

O modelo "empresa paga tudo" com dinheiro em custodia deve ser validado antes
de producao: a Resolucao BCB 518/2025 (arranjos de pagamento / prestadores de
servicos de ativos virtuais e regras de custodia) entra em vigor com prazo de
adequacao ate 2027. Enquanto isso, `TAX_MODEL_NEW=false` mantem o historico e
nenhum valor novo e cobrado. A validacao contabil/regulatoria e pre-requisito
para ligar a flag.

### Testes

- `.tools/test-taxmodel.mjs` + `.tools/test-taxmodel.ps1` (fases OFF/ON, mock):
  ?1 LEGACY, ?2 NEW + estimativa (10000/25000/25001/100000), ?3 webhook com 2
  lancamentos, ?4 release liquido vs bruto, ?5 carteira liquido vs bruto.
- Integrado como passo 15/15 da bateria; nenhum teste existente alterado.

---

## 4k. Frontend Fase 1 — contratos usados, decisoes e gaps

### Contratos consumidos (sem alterar nada no backend)

| Tela | Chamada | Observacao |
|---|---|---|
| Guard de sessao | `GET /api/auth/me` | layout `(web)` redireciona para `/login` se 401 |
| Login | `POST /api/auth/login` | cookie `freelaz_session` httpOnly |
| Cadastro | `POST /api/auth/register` | papel Profissional nasce PENDENTE |
| Home | `GET /api/jobs?limit=50` | busca/filtros **no cliente** sobre a pagina 1 |
| Vaga | `GET /api/jobs/[id]` | 404 -> "Vaga nao encontrada" |
| Perfil | `GET /api/auth/me` + `GET /api/profile/professional` | 409 = papel nao ativado |
| Carteira | `GET /api/wallet?limit=50` | 403 = papel Profissional inativo |
| Mensagens | `GET /api/hirings` | chats `ABERTO` + `ENCERRADO` no cliente |
| Candidatura | `POST /api/jobs/[id]/apply` | `{}` (sem body util); 201/409 |
| Conversa | `GET /api/hirings/[id]/chat` + `POST .../chat/messages` + `PATCH .../messages/read` | Fase 2.1 |
| Selecao | `POST /api/jobs/[id]/select` | `{ applicationId }` -> cria Hiring AGUARDANDO_PAGAMENTO |
| Pagamento | `POST /api/payments/create` + `GET /api/hirings/[id]` | Pix QR/copia-e-cola, polling 5s, redirect ao chat |

### Decisoes de produto tomadas para destravar a Fase 1

1. **Tab bar com 5 itens fixos** (Inicio, Buscar, Mensagens, Carteira, Perfil).
   As referencias mostravam 4 itens em 5 telas e 5 na Carteira (com "Extrato").
   Padronizado em 5; "Extrato" virou a secao de movimentacoes da Carteira.
2. **Buscar fundido na Home.** Nao havia imagem da tela de busca. A tab Buscar
   aponta para `/?focus=search`, foca o campo e mantem a tab ativa.
3. **Home v1 (funcional) e a canonica.** Havia duas variantes; a com banner
   hero foi descartada no MVP.
4. **Sem imagem de vaga.** `JobPosting` nao tem foto; o bloco colorido e um
   gradiente derivado da categoria (decorativo, nao representa dado).
5. **"Oportunidades em destaque"** so aparece com `urgentBoost = true` real; as
   demais vagas vao para "mais recentes".
6. **Controles fora de escopo desabilitados** com `title`/nota: sino, favoritar,
   editar perfil, depositar/sacar/transferir/historico. Desde a Fase 2.1,
   "Enviar proposta" funciona (ver 4l).
7. **Sem grafico de ganhos** na Carteira: nao ha serie historica na API.
8. **Sem contador de nao lidas** em Mensagens/tab bar: `Chat` nao expoe
   `unreadCount` e nao ha endpoint agregado. A tela de conversa marca como lida
   via `PATCH .../chat/messages/read`.
9. **Sem lista de conversas propria:** `/api/hirings` e a unica fonte; mostramos
   `ABERTO` e `ENCERRADO` (Fase 2.1). `AGUARDANDO_PAGAMENTO` fica fora porque
   ainda nao existe conversa.

### Gaps/limitacoes conhecidos da Fase 1

- **Paginacao:** a Home carrega 50 vagas e informa "Mostrando as 50 primeiras de
  N". Com 51 abertas hoje, 1 vaga nao aparece e nao entra na busca client-side.
- **Busca client-side:** filtra apenas o que foi carregado (sem `?q=` no backend).
- **Chat:** implementado na Fase 2.1 (lista + conversa + envio + polling + lidas).
  Ainda sem anexos/emoji/voz (decisoes 5-7) e sem badge de nao lidas.
- **Perfil:** sem edicao; `profileStrength` e somente leitura.
- **Carteira:** sem grafico/serie; acoes financeiras desabilitadas.
- **Documento mascarado:** `GET /api/auth/me` ja devolve o documento mascarado.
- **Performance:** a Home renderiza ate 50 linhas (sem virtualizacao); aceitavel
  no MVP, revisar se o volume de vagas crescer.

## 4m. Frontend Fase 2.2 — selecao de candidato e checkout Pix

### Contratos consumidos

| Acao | Chamada | Contrato real |
|---|---|---|
| Selecionar | `POST /api/jobs/[id]/select` | body `{ applicationId }`; 200 `{ selected, application }` com `application.hiring.id`; 403/404; regras de negocio (vaga fechada, hiring ativo) -> 422 |
| Cobranca | `POST /api/payments/create` | body `{ hiringId }`; `{ paymentId, status, pix: { qrCodeBase64, payload, expirationDate } \| null, alreadyCreated? }`; 503 sem Asaas; 409 status != AGUARDANDO_PAGAMENTO |
| Status | `GET /api/hirings/[id]` | `hiring.status`; sai de AGUARDANDO_PAGAMENTO quando o webhook confirma |

### Decisoes

1. **`hiringId` vem da propria resposta da selecao** (`application.hiring.id`),
   sem endpoint extra. Se faltar, a tela recarrega a vaga e mostra toast.
2. **QR Code e base64 puro** (`qrCodeBase64`), renderizado como
   `data:image/png;base64,...` em `<img>` (sem `next/image`, como na Fase 1.2).
   O texto `payload` alimenta o "Pix copia e cola". Nada e logado.
3. **"Pago" = status diferente de AGUARDANDO_PAGAMENTO.** O checkout nao depende
   de `providerPaymentId`; quem muda o status e o webhook do Asaas.
4. **Polling maximo de 30 tentativas** (5s = 2,5 min). Ao estourar, para e mostra
   "Pagamento nao confirmado. Verifique seu banco." + "Ja paguei" (GET unico).
5. **409 do create** e tratado como "ja saiu de AGUARDANDO_PAGAMENTO": a tela
   recarrega o status e entra no polling, em vez de mostrar erro.
6. **503/erro do provedor** tem estado proprio ("Pagamento indisponivel no
   momento") com retry; nenhuma cobranca e inventada no cliente.
7. **Dono da vaga nao ve CTA de candidatura** (desde a 2.1.1) e agora ve
   "Selecionar candidato" apenas em candidaturas PENDENTES; as demais mostram
   "Suplente" desabilitado (o backend tambem converte PENDENTES em SUPLENTE).

### Gaps/limitacoes

- Sem tela de "pagamento aprovado" intermediaria: o redirect e direto ao chat.
- Sem contagem regressiva do QR (a API devolve `expirationDate`, exibido como
  texto apenas nao; fica para uma proxima fase).
- Selecao nao tem confirmacao em modal: um clique ja cria o Hiring
  (AGUARDANDO_PAGAMENTO). Cancelar depois exige o fluxo de cancelamento, que
  ainda nao esta no frontend.

### 4m.1 Pitfall de ambiente: `$` em `ASAAS_API_KEY`

`@next/env` expande `$VAR` nos valores do `.env`. Com
`ASAAS_API_KEY="$aact_hmlg_..."` (sem escape) a chave vira string vazia em
runtime: `POST /api/payments/create` responde 503 ("nao configurado") mesmo
com a credencial visivelmente preenchida. Correto: `ASAAS_API_KEY="\$aact_..."`.
O proprio `.env` documenta o procedimento; o sintoma engana porque
`GET`/`Content` da linha parecem normais. Confirmado com
`loadEnvConfig()` (chave presente=false antes, len=166 depois). `.env` e
gitignored — ajuste local, nenhum codigo/commit envolvido.


## 4l. Frontend Fase 2.1 — candidatura e chat

### Contratos consumidos (backend intocado)

| Acao | Chamada | Contrato real |
|---|---|---|
| Candidatar | `POST /api/jobs/[id]/apply` | sem body util; 201 `{application}`; 409 duplicata/reservada/fechada; 403 papel inativo/privada |
| Conversa | `GET /api/hirings/[id]/chat` | `{ chat, messages, hasMore, nextBefore }`; 404 oculto/sem acesso |
| Enviar | `POST /api/hirings/[id]/chat/messages` | `{ body }`; 201 `{message}`; 409 chat nao ABERTO |
| Lidas | `PATCH /api/hirings/[id]/chat/messages/read` | marca as recebidas; resposta sem corpo util para a UI |
| Cabecalho | `GET /api/hirings/[id]` | `hiring.counterpart` e `hiring.jobTitle` |

### Decisoes

1. **Sem campo de mensagem na candidatura.** `Application` nao tem coluna de
   texto e a rota nao le body. O campo "Mensagem (opcional)" existe no modal,
   mas **desabilitado** e com nota: melhor do que descartar o texto do usuario em
   silencio (ou fingir que enviou). Quando o backend ganhar `message`, basta
   habilitar o campo e mandar `{ message }`.
2. **"Ja candidatado" so e detectavel pelo 409.** `GET /api/jobs/[id]` nao
   devolve candidatura do usuario logado. Na primeira tentativa o 409
   ("Voce ja se candidatou a esta vaga") vira botao "Proposta enviada"
   desabilitado + toast; nao ha estado previo ao clicar.
3. **Lista inclui ENCERRADO.** A Fase 1 mostrava so `ABERTO`, o que tornava a
   tela de conversa encerrada inalcancavel. Chats ocultos (`hiddenAt`) ainda
   aparecem em `/api/hirings` e abrem o estado 404 "Conversa nao disponivel".
4. **"Ultima mensagem" = horario.** `/api/hirings` so devolve
   `chat.lastMessageAt`; o texto exigiria N chamadas a `/chat`. A linha mostra o
   horario relativo do `lastMessageAt`.
5. **Sem badge na tab bar / chips de nao lidas.** Nao existe contador agregado;
   inventar exigiria varrer todas as conversas no cliente.
6. **Polling puro (5s), sem WebSocket**, conforme decisao de produto; envio e
   otimista (a mensagem do 201 entra na lista sem esperar o proximo poll).
7. **`PATCH read` tambem no polling**, quando chega mensagem nova com a conversa
   aberta — evita que a conversa "pisque" como nao lida em outra aba.

### Gaps/limitacoes

- Sem anexos, emoji picker ou audio (decisoes 5-7 seguem pendentes).
- Sem paginacao "carregar anteriores" na conversa: o backend devolve
  `hasMore/nextBefore`, mas a tela carrega o historico inicial inteiro que a API
  manda. Revisar quando houver conversas longas.
- Candidatura nao tem "cancelar proposta" nem acompanhamento de status.
- Sem estado previo de "ja candidatado" ao abrir a vaga (depende de mudanca no
  contrato de `GET /api/jobs/[id]`).

## 4n. Frontend Fase 2.3a — codigo de turno

### Contratos consumidos

| Acao | Chamada | Contrato real |
|---|---|---|
| Consultar | `GET /api/hirings/[id]` | `openingCode`, `closingCode`, `closingCodeUsedAt`, `completedAt`, `side`, `jobPosting.startsAt/endsAt` — para as duas partes |
| Confirmar | `POST /api/hirings/[id]/codes` | body `{ kind: "OPENING" \| "CLOSING", code }`; 200 `{ hiring: {...} }`; 403 se nao for CONTRACTOR; 400 body; 422 regra/limite |

### Decisoes

1. **Card dentro da conversa** (`ShiftCodeCard`, `position: sticky`), porque o
   chat ja tem o polling de 5s e e onde as duas partes estao.
2. **Quem mostra x quem confirma** pela `hiring.side` que a API devolve:
   profissional recebe o codigo em destaque + Copiar; empresa recebe o input.
   A autorizacao real continua no backend (403); a tela nao cria regra propria.
3. **"Janela aberta" = o codigo existir**, nao um intervalo calculado no
   cliente. O backend nao valida horario na confirmacao; o horario so decide a
   geracao (55-65 min antes). Mostrar "janela encerrada" seria inventar regra.
4. **Fora da janela**: "Disponivel a partir de {startsAt|endsAt - 1h}"; se essa
   hora ja passou e o codigo ainda e null, "O codigo ainda nao foi liberado".
5. **Polling** reaproveitado: cada tick busca chat + hiring em paralelo;
   transicoes de status trocam o card sem reload.
6. **Bloqueio**: a mensagem 422 com "bloqueado apos N tentativas" desabilita
   input/botao na hora; nao ha contador local (o servidor e a fonte).
7. O codigo nunca vai para console/log.

### Gaps/limitacoes

- **Carteira nao reflete o hiring de teste**: o fluxo 2.2 simulou o pagamento
  direto no status, sem ledger/retencao (`recordRetention`); o repasse e job
  semanal (`weekly-payout`), fora desta fase. Nada de dinheiro foi movido.
- Nao ha contagem regressiva nem "expirou": ver decisao 3.
- O reverso (`CONCLUIDO -> EM_ANDAMENTO`) nao existe no backend (so via
  disputa); o teste do bloqueio exigiu reset manual e foi restaurado.
- Avaliacao (2.3b) e publicar vaga (2.3c) seguem pendentes; a avaliacao libera
  2h depois de `closingCodeUsedAt` (`isEvaluationUnlocked`).

## 4o. Frontend Fase 2.4a — Home visual + 4 abas

### Escopo entregue

- `BottomTabBar` com 4 itens (Inicio, Mensagens, Carteira, Perfil) e
  `repeat(4, 1fr)`; `useSearchParams` e a dependencia de `Suspense` no layout
  removidas.
- Rota `/buscar` apagada (404). Nenhum link restante para `?focus=search`.
- Home: hero com foto, busca compacta, 6 chips de categoria com icone,
  carrossel "Vagas perto de voce" (260px, snap) e lista vertical com
  `id="lista-vagas"` para a ancora do hero.
- Busca e filtros continuam client-side sobre `GET /api/jobs?limit=50`.

### Foto do hero (licenca)

O Unsplash bloqueia scraping direto (HTTP 401), entao a foto veio do Wikimedia
Commons: "Campos do Jordao - Paisagem / Landscape", de **Deni Williams**
(CC BY 2.0), redimensionada para 1200x800 e recomprimida (232 KB) em
`public/hero-itajuba.jpg`. O credito aparece em 8px no canto do hero e nao ha
dependencia externa em runtime. E uma paisagem da Serra da Mantiqueira, nao uma
foto de Itajuba especifica.

### Dados reais x 6 chips

A base de dev tem apenas **2 vagas ABERTA+PUBLICA com `endsAt` no futuro**
(seguranca e garcom), entao a tela real mostra 2 chips e 2 cards. Para validar
os 6 chips, os icones e o snap, foram criadas 4 vagas temporarias
(`[TESTE 2.4a]`, fotografo/cozinheiro/dj/motorista, uma delas com
`urgentBoost`) direto no banco e **removidas em seguida**. Nenhum dado mock
ficou na tela ou no codigo.

### Decisoes

1. **Categorias normalizadas** (`trim().toLowerCase()`, sem acento) porque o
   banco tem `eventos` (67) e `EVENTOS` (5) como categorias distintas. O chip
   filtra pela chave normalizada; o rotulo e capitalizado.
2. **Sem chip "Todas"**: clicar no chip ativo limpa o filtro (padrao que ja
   existia).
3. **Selo "Verificado"** so aparece quando `contractor.verified` e true (dado
   real de `verificationStatus`). Nao e decorativo.
4. **"N vagas"** vem da contagem real dos jobs carregados por cidade +
   categoria; nunca um numero inventado.
5. **Lista vertical repete o carrossel** de proposito: com poucas vagas
   abertas, excluir as do carrossel deixaria a secao vazia. O carrossel e um
   recorte (urgentes primeiro, ate 5) e a lista e o acervo completo.
6. **Filtros avancados preservados** atras do botao de sliders (cidade, faixa
   de valor) e a ordenacao Data/Valor foi para dentro do painel. A v1 tinha
   esses controles visiveis; o redesign priorizou a hierarquia da referencia.
7. **Fallback da foto**: se `hero-itajuba.jpg` nao carregar, o gradiente
   `#0066FF -> #0B1F44` + overlay mantem o hero legivel (nao ha TODO pendente).
8. **Scroll suave** da ancora via `scrollIntoView` + `scroll-margin-top` de
   68px (header sticky); o hash e atualizado com `replaceState`.

### Adiado (depende de backend/schema)

- **Abas "Freelance / CLT / Prestadoras"**: `JobPosting` nao tem `modality`
  (2.4b).
- **"Vagas na sua regiao" (mapa)**: nao ha geo/lat-long no `JobPosting`
  (2.4b).
- **"Profissionais em destaque"**: depende de `GET /api/professionals/featured`
  (2.5), que nao existe.
- **Tags de card ("Pagamento no dia", "Alimentacao")**: nao ha `tags[]` no
  schema (2.4b).

### Gaps/limitacoes

- `categoryImages` nao tem foto para `fotografo`, `dj`, `motorista` etc.;
  essas categorias caem em `default.jpg` (comportamento antigo, sem quebra).
- O hero mostra "Itajuba - MG" fixo (como no pedido), enquanto as vagas vem de
  contratantes de cidades variadas; a proximidade real depende de geo (2.4b).
- A Home carrega no maximo 50 vagas por pagina (`hasMore`); nao ha "carregar
  mais" — o aviso de rodape informa quantas estao sendo mostradas.

## 4p. Fase 2.3c — modalidade, abas Freelance/CLT e publicar vaga

### Escopo entregue

- `JobPosting.modality String @default("FREELANCE")` + 18ª migracao
  (`20261025025813_etapa23c_modality`). Backfill automatico pelo default; as
  vagas antigas ficaram FREELANCE.
- `POST /api/jobs` aceita `modality` (FREELANCE/CLT/PRESTADORA, normalizado
  para maiusculas); ausente = FREELANCE; invalida = 422. Resposta 201 igual.
- `GET /api/jobs?modality=X` filtra; sem o parametro o comportamento e
  identico ao anterior (`?modality=` vazio tambem = sem filtro); invalida =
  422 em vez de ignorar o filtro.
- `apiTypes.JobCard.modality` e `jobPublic.jobCard` expoem o campo.
- Home com abas Freelance (padrao)/CLT, contador real por modalidade, estado
  vazio "Nenhuma vaga CLT disponivel ainda." e `sessionStorage`.
- FAB circular azul (56px) acima da tab bar, so para Contratante ativo.
- `/publicar` com guard de servidor + formulario completo, POST real, toast e
  redirect para `/vaga/[id]`.

### Desvios do pedido (e por que)

1. **FAB nao olha `/api/auth/me`.** A Home nao carrega esse endpoint; o papel
   vem de `getCurrentUser()` + `hasActiveRole(user, "CONTRATANTE")` no server
   component, a mesma fonte do guard de `/publicar`. O resultado visual e o
   mesmo e nao ha requisicao extra.
2. **`visibility` nao e enviada.** `POST /api/jobs` grava `PUBLICA` fixo
   (PRIVADA exige `targetProfessionalId`, fluxo "Me contrate"). O select mostra
   as duas opcoes, com "Privada" desabilitada e nota explicando.
3. **Cidade/UF nao estao em `JobPosting`.** O formulario faz
   `PUT /api/profile/contractor { city, state }` antes do POST; a localizacao
   do card vem de `contractor.city/state`. UF entrou como select (27 UFs)
   porque `User.state` ja existia e e exibido como "Cidade - UF".
4. **Categoria e lista fixa de 18** (as que tem imagem + as que existem em
   vagas). `/api/jobs` aberto pode estar vazio ou ter so 2 categorias, e um
   select sem opcoes travaria a publicacao. O backend normaliza para
   minusculas.
5. **Datas usam `datetime-local`**, nao `date`: `startsAt`/`endsAt` sao
   instantes ISO e o detalhe mostra dia + horario. O valor e convertido com
   `toISOString()`.
6. **Valor em reais inteiros** (input so aceita digitos, `valueCents =
   reais * 100`). A API exige inteiro positivo em centavos; centavos nao sao
   oferecidos no formulario para nao sugerir precisao que o produto nao usa.
7. **Toast na propria tela** e redirect depois de ~0,9s para `/vaga/[id]`.
   A alternativa (flash em `sessionStorage` lido pelo detalhe) exigiria
   alterar `JobDetailScreen`, que esta fora do escopo da fase.

### Testes (dev, banco real)

- `GET /api/jobs` = 2 (inalterado); `?modality=FREELANCE` = 2; `?modality=CLT`
  = 0; `?modality=PIX` = 422.
- `POST` sem `modality` = 201 com `modality: "FREELANCE"`; com `"PIX"` = 422.
- `POST` como profissional = 403.
- `/publicar` como profissional = redirect para `/`; como contratante abre o
  formulario com cidade/UF pre-preenchidos do perfil.
- Publicacao CLT pelo formulario: toast "Vaga publicada", redirect para
  `/vaga/cmvn93h3q0005sxdfmelx2ylj`, detalhe com "Itajuba - MG", R$ 210 e
  "Sexta-feira, 09:00 – 18:00"; a aba CLT passou a "1 vaga" com a vaga na
  lista. As 2 vagas `[TESTE 2.3c]` foram removidas depois; a base voltou a 2
  vagas abertas.
- `sessionStorage` restaura a aba depois do reload e do redirect; sem storage
  o padrao e Freelance.

### Adiado

- **Aba Prestadoras**: `modality` aceita PRESTADORA, mas a Home so mostra 2
  abas (MVP). TODO 2.4b.
- **CLT como fluxo comercial** (plano, contrato, beneficios): so o campo.
- **Boost/urgencia**: nao tocado (V2a).
- **Edicao/exclusao de vaga**: `PATCH /api/jobs/[id]` ja aceita `modality`
  parcialmente, mas nao ha UI.
- **`modality` no detalhe da vaga**: o card/detalhe nao exibe a modalidade;
  so a Home usa o campo para filtrar.

### Gaps/limitacoes

- Os contadores das abas usam `total` da modalidade inteira, nao o resultado da
  busca/filtros aplicados (que sao client-side). Isso e proposital: o numero
  responde "quantas vagas existem nesta modalidade".
- Trocar de aba limpa a categoria selecionada (os chips sao derivados da
  modalidade ativa), mas mantem busca e faixa de valor.
- Nao ha preview, rascunho nem upload de imagem no formulario.
- O backend nao exige verificacao para publicar (so o papel Contratante
  ativo); a tela tambem nao bloqueia por isso.


