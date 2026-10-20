-- Etapa 3 — eventos de webhook do Asaas + chargeback (migração ADITIVA).
--
-- Motivo (ver .protocol/findings.md > contrato oficial de webhook):
--  - O Asaas entrega "at-least-once" e reenvia eventos; o campo `id` do evento
--    é a chave de idempotência documentada. Precisamos de uma tabela DURÁVEL
--    gravada ANTES do HTTP 200 para não perder eventos nem duplicar efeitos.
--  - O chargeback (PAYMENT_CHARGEBACK_REQUESTED / _DISPUTE /
--    AWAITING_CHARGEBACK_REVERSAL) precisa de representação própria,
--    separada da `Dispute` interna do Freelaz.
--
-- Nenhum dado existente é alterado ou removido. Só são criadas tabelas/índices
-- novos. O ledger (LedgerEntry) NÃO é tocado por esta migração.

-- CreateTable
CREATE TABLE "AsaasEvent" (
    "id" TEXT NOT NULL,
    "asaasEventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "paymentId" TEXT,
    "externalReference" TEXT,
    "payloadHash" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'RECEBIDO',
    "actionTaken" TEXT,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AsaasEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargebackEvent" (
    "id" TEXT NOT NULL,
    "asaasEventId" TEXT,
    "providerChargebackId" TEXT,
    "paymentId" TEXT NOT NULL,
    "externalStatus" TEXT NOT NULL,
    "externalReason" TEXT,
    "disputedValueCents" INTEGER,
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "hiringId" TEXT,
    "disputeId" TEXT,
    "actionTaken" TEXT,
    "state" TEXT NOT NULL DEFAULT 'ATIVO',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargebackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AsaasEvent_asaasEventId_key" ON "AsaasEvent"("asaasEventId");

-- CreateIndex
CREATE INDEX "AsaasEvent_event_receivedAt_idx" ON "AsaasEvent"("event", "receivedAt");

-- CreateIndex
CREATE INDEX "AsaasEvent_paymentId_idx" ON "AsaasEvent"("paymentId");

-- CreateIndex
CREATE INDEX "AsaasEvent_processingStatus_receivedAt_idx" ON "AsaasEvent"("processingStatus", "receivedAt");

-- CreateIndex
CREATE INDEX "ChargebackEvent_paymentId_idx" ON "ChargebackEvent"("paymentId");

-- CreateIndex
CREATE INDEX "ChargebackEvent_hiringId_idx" ON "ChargebackEvent"("hiringId");

-- CreateIndex
CREATE INDEX "ChargebackEvent_state_idx" ON "ChargebackEvent"("state");

-- AddForeignKey
ALTER TABLE "ChargebackEvent" ADD CONSTRAINT "ChargebackEvent_asaasEventId_fkey" FOREIGN KEY ("asaasEventId") REFERENCES "AsaasEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackEvent" ADD CONSTRAINT "ChargebackEvent_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackEvent" ADD CONSTRAINT "ChargebackEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
