-- Etapa 3.1 — campos REAIS do contrato de chargeback (migração ADITIVA).
--
-- Motivo (ver .protocol/findings.md > P2/P3):
--  A conferência da documentação oficial (docs.asaas.com > "Recuperar uma única
--  cobrança" > PaymentChargebackResponseDTO) mostrou que o objeto `chargeback`
--  NÃO envia `createdDate`/`updatedDate` (nomes que o código supunha). Os campos
--  reais de data/disputa são:
--    - `disputeStartDate`                (date) — abertura do chargeback
--    - `deadlineToSendDisputeDocuments`  (date) — limite para enviar documentos
--    - `disputeStatus`                   (enum REQUESTED/ACCEPTED/REJECTED)
--
--  São adicionados como colunas NULAS (opcionais) — nenhuma linha existente é
--  alterada, nenhum dado é removido, o ledger não é tocado. Os nomes legados
--  `providerCreatedAt`/`providerUpdatedAt` são MANTIDOS (histórico intacto).
--
--  NÃO altera a migração 20261020120000_etapa3_asaas_eventos_chargeback.

-- AlterTable
ALTER TABLE "ChargebackEvent" ADD COLUMN "providerDisputeStartDate" TIMESTAMP(3);
ALTER TABLE "ChargebackEvent" ADD COLUMN "deadlineToSendDisputeDocuments" TIMESTAMP(3);
ALTER TABLE "ChargebackEvent" ADD COLUMN "providerDisputeStatus" TEXT;
