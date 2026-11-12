# CLAUDE.md — Freelaz

## Stack técnica
- **Gateway de pagamento:** **Asaas** (Pix + cartão + transferência Pix de saída). O Freelaz é o único merchant of record — **sem split automático em produção** (split existe no código mas está desativado por flag `ASAAS_SUBACCOUNT_ENABLED`, aguardando decisão de negócio). Retenção e repasse controlados pelo próprio backend via `LedgerEntry`.

## Pagamento (Asaas)

**Arquitetura:** o Freelaz é o único merchant of record. Todo dinheiro entra na conta Asaas do Freelaz e só sai por evento confirmado.

1. Empresa paga via Checkout Asaas (Pix) → dinheiro entra na conta do Freelaz → `Hiring.status` muda de `AGUARDANDO_PAGAMENTO` para `RETIDO` (via webhook idempotente)
2. Backend registra `LedgerEntry` do tipo `RETENCAO` — saldo pendente do profissional
3. Conclusão do serviço (código de fechamento + 2h de janela de avaliação + sem disputa/chargeback) → `releasePayout` cria transferência Pix via API Asaas para a chave Pix cadastrada do profissional
4. Repasse **semanal** em lote (`cron/payouts`) + opção de **saque instantâneo** (com taxa) via `/api/wallet/withdraw`
5. **Códigos de turno** (6 dígitos, uso único) gerados por `cron/shift-codes` 1h antes do início/fim; combinados com geolocalização, horário e chat — nunca prova absoluta isolada
6. Gorjeta: opcional, 100% ao profissional, sem comissão
7. Extrato do profissional: nunca exibe a comissão retida; mostra total líquido, comparativo com mês anterior, média de avaliação do período, detalhamento líquido por serviço

### Idempotência (4 camadas)

- **Cobrança:** `chargeService.ensureCharge` → reconciliação com Asaas + `ChargeAttempt` (unique `entity+entityId+attempt`) + advisory lock por operação. Nunca cria cobrança duplicada.
- **Webhook:** `AsaasEvent` persistido antes de qualquer efeito (`event.id` único). Reenvio é no-op.
- **Payout:** `Payout.idempotencyKey @unique` + `providerTransferId @unique`. Dupla proteção contra transferência duplicada.
- **Reconciliação diária:** `cron/reconciliation` compara ledger com payout e sinaliza divergência (nunca corrige sozinho).

### Modelo de taxas (LEGACY vs NEW)

- **LEGACY** (default): empresa paga o bruto; profissional recebe líquido (bruto - comissão 10%); Freelaz fica com a comissão.
- **NEW** (flag `TAX_MODEL_NEW=true`): empresa paga bruto + serviceFee + withdrawalFee estimada; profissional recebe **100% do bruto**; Freelaz fica com as taxas.
- **Split Asaas** (`ASAAS_SUBACCOUNT_ENABLED`): reservado, desativado. Quando ativado, direciona parte do valor para a subconta Asaas do profissional **no momento do pagamento** — **viola a segregação de fundos** do Freelaz. Não ativar sem revisão jurídica.

### Holding-timeout

- `cron/holding-timeout` roda diariamente e, se uma contratação está `RETIDO` há mais de 3 dias sem revisão, abre uma `Dispute` automática para o admin analisar. **Nunca move dinheiro automaticamente.**

## Notas históricas

- Versões anteriores deste documento e do código referenciam "Mercado Pago" como gateway. A migração para **Asaas** foi concluída antes da Fase 3. Todo código e infraestrutura atuais usam Asaas. Se encontrar "Mercado Pago" em comentários antigos, ignore — não é a arquitetura vigente.
