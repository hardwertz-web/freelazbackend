-- Etapa 4 (D6=A2) — encerramento de chargeback por DESFECHO VERIFICADO
-- (migração ADITIVA).
--
-- Motivo (decisão aprovada pelo usuário em 2026-10-20; ver
-- .protocol/decisions/D1-D8.md):
--  D6=A2 permite encerrar (`state` "ATIVO" -> "ENCERRADO") um ChargebackEvent
--  SOMENTE quando há desfecho VERIFICÁVEL pela doc oficial (evento de ganho
--  `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` + status do provedor compatível). Para
--  auditar QUANDO e POR QUE o encerramento aconteceu, são adicionadas duas
--  colunas NULAS:
--    - `closedAt`     (timestamp) — momento do encerramento verificado;
--    - `closedReason` (texto curto) — ex.: "desfecho_verificado:PAYMENT_RECEIVED".
--
--  Ambas são ADITIVAS e OPCIONAIS: nenhuma linha existente é alterada, nenhum
--  dado é removido, o ledger e os estados atuais são preservados. NÃO altera as
--  migrações 20261020120000_etapa3_asaas_eventos_chargeback nem
--  20261020150000_etapa31_chargeback_campos_doc.
--
--  NOTA: esta migração APENAS adiciona colunas. O preenchimento ocorre em
--  runtime por `closeChargebackOnVerifiedOutcome` (asaasEventService.ts).
--  Timeout NÃO encerra (isso seria D6=A3, rejeitado) — as colunas ficam nulas
--  até um desfecho realmente verificado.

-- AlterTable
ALTER TABLE "ChargebackEvent" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "ChargebackEvent" ADD COLUMN "closedReason" TEXT;
