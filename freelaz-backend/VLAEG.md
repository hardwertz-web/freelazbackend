# Protocolo V.L.A.E.G. — Freelaz

Este documento organiza o projeto segundo o protocolo V.L.A.E.G. (Visão, Link, Arquitetura, Estilo, Gatilho). Ele complementa o `CLAUDE.md` (que tem o detalhe completo de cada regra de produto) — aqui o objetivo é dar a visão estrutural de alto nível, para orientar qualquer agente (Claude Code ou outro) que for trabalhar no projeto.

---

## V — Visão

**Objetivo e resultado final esperado:**

O Freelaz é um marketplace que conecta profissionais freelancers e prestadores de serviço (bartender, garçom, diarista, eletricista, encanador, pedreiro, influenciador digital, etc.) com empresas e pessoas físicas que precisam contratá-los — para trabalho avulso (freelance) ou fixo (CLT).

**Resultado final esperado da primeira versão (MVP):**
- Cadastro único (CPF/CNPJ, papéis profissional/contratante) funcionando
- Ciclo completo de uma contratação rodando de ponta a ponta: publicar vaga → candidatura/convite direto → seleção → pagamento retido → chat → códigos de turno → conclusão → avaliação → repasse
- Validado primeiro em modo de teste (sandbox do Mercado Pago, sem dinheiro real), depois lançado na cidade piloto (Itajubá, MG)

**O que NÃO é objetivo deste momento:** app com volume nacional, automação total de disputas, qualquer coisa que dependa de CNPJ/gateway em produção antes da validação local.

---

## L — Link (integrações e conexões externas)

| Integração | Para quê | Status |
|---|---|---|
| **Asaas** (Checkout + Webhooks + Transferências Pix) | Cobrança da empresa, retenção interna, repasse ao profissional | Código escrito, testável em sandbox (ver README) | Subcontas Asaas existem no schema com flags off (não ativar sem decisão). |
| **WhatsApp Business API** | Notificações críticas (vaga compatível, código de turno, pagamento liberado) | Ainda não implementado — fase de polimento |
| **Instagram / Facebook / TikTok (OAuth)** | Verificar/exibir redes sociais no perfil de quem usa a categoria "influenciador digital" | Planejado, ainda não codificado |
| **Postgres (Neon/Supabase em dev)** | Banco de dados principal | Schema Prisma pronto |
| **ngrok** (só em desenvolvimento local) | Expor o webhook do Mercado Pago publicamente antes de ter domínio próprio | Uso temporário, só em dev |

Se o projeto migrar para automações externas via **MCP** (ex: n8n para orquestrar notificações, relatórios administrativos, ou integrações futuras), documentar aqui cada ponte adicionada, com o mesmo formato de tabela.

---

## A — Arquitetura

**Stack:** Next.js (App Router) + PostgreSQL + Prisma + Asaas. Ver `CLAUDE.md` para o detalhe de cada modelo de dado e regra de negócio.

**Princípio geral:** confiabilidade antes de velocidade — isso significa:
- O backend é sempre a fonte da verdade (nunca confiar em estado do frontend)
- Nenhuma transferência de dinheiro acontece sem registro auditável (`LedgerEntry`) e chave de idempotência
- Mudança de status de uma contratação nunca é uma escrita livre — sempre passa por uma função de serviço que valida a transição

**Camadas:**
1. `prisma/schema.prisma` — modelo de dados (fonte única da estrutura)
2. `src/lib/` — clientes e utilitários de baixo nível (Asaas, Prisma, idempotência)
3. `src/services/` — regras de negócio (seleção de candidato, cancelamento, geração de código, repasse)
4. `src/app/api/` — rotas HTTP, finas, só traduzindo requisição → chamada de service → resposta

**Ordem de construção (fases):** ver seção "Fases" no `CLAUDE.md` — fundação → loop do marketplace → dinheiro → confiança/segurança → monetização avançada/admin → polimento. Não pular a ordem.

---

## E — Estilo

**Fonte da verdade visual:** 6 imagens em `C:\Users\PC\Desktop\Herbert\` (10.51.56–58.jpeg). Protótipo HTML `design-reference/freelaz-prototipo.html` não existe nesta máquina. Identidade de marca documentada no `CLAUDE.md`:
- Azul Principal `#0066FF`, Azul Escuro `#0B1F44`, Cinza Claro `#E8EEF7`
- Tipografia Montserrat
- Cantos arredondados, sombra leve em cards, ícones outline azuis, mobile-first

**Regra de estilo de código** (para manter consistência entre sessões/agentes diferentes trabalhando no projeto):
- TypeScript estrito, sem `any` não justificado
- Toda rota de API retorna erro com `{ error: string }` e o status HTTP correto
- Comentários em português, explicando o "porquê" de decisões não óbvias (não o "o quê", que o código já mostra)
- Valores monetários sempre em centavos (`Int`), nunca `float`/`Decimal` solto

---

## G — Gatilho (eventos que disparam ações)

| Gatilho | Dispara |
|---|---|
| Pagamento aprovado (webhook Asaas) | Retém saldo, marca vaga como `PREENCHIDA`, libera o chat |
| Vaga começa em ~1h | Gera código de abertura (`generateOpeningCodesDue`, job agendado) |
| Turno termina em ~1h | Gera código de fechamento (`generateClosingCodesDue`, job agendado) |
| Código de fechamento confirmado pela empresa | Marca `CONCLUIDO`, inicia contagem de 2h para liberar avaliação |
| 2h após o código de fechamento | Libera as opções de avaliação mútua |
| Cancelamento (qualquer origem) | `cancelHiring` — reembolso conforme política, reabre a vaga, filtra suplentes por conflito de agenda |
| Fim de semana/dia configurado | Repasse semanal em lote dos saldos liberados |
| Diariamente (madrugada) | Job de reconciliação financeira (ledger interno x saldo real no Asaas) |

Os jobs agendados (`generateOpeningCodesDue`, `generateClosingCodesDue`, repasse semanal, reconciliação diária) ainda precisam de um agendador real (ex: cron job, Vercel Cron, ou fila) — o código das funções já existe em `src/services/`, falta só o disparo periódico.

---

## Estado atual do projeto (2026-10-29)
Para o estado REAL de implementação, ver:

- `.protocol/progress.md` — sessão por sessão, o que foi feito
- `.protocol/findings.md` — descobertas técnicas, lacunas, decisões
- `.protocol/decisions/D1-D8.md` — decisões de chargeback
- `.protocol/frontend-spec.md` — spec visual atualizada
- `VLAEG.md` — visão de alto nível

Este arquivo (VLAEG.md) contém visão/estrutura; decisões de produto e estado detalhado estão nos arquivos acima.

## Como usar este documento

Antes de iniciar qualquer sessão de trabalho no projeto (com Claude Code ou qualquer outro agente), leia este arquivo e os documentos em `.protocol/` juntos. Depois, siga o **Protocolo 0** (pasta `.protocol/`) para saber exatamente em que ponto o projeto está e o que fazer a seguir.
