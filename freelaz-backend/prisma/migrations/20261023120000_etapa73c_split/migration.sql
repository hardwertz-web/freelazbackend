-- Etapa 7.3c - split da cobranca no chargeService (feature flag + fallback).
-- Migracao ADITIVA: 3 colunas nullable/default. Nenhuma coluna/tabela
-- existente e alterada e nenhum dado e reescrito.
ALTER TABLE "User" ADD COLUMN "asaasSubaccountWalletId" TEXT;
ALTER TABLE "Hiring" ADD COLUMN "asaasSplitId" TEXT;
ALTER TABLE "Payout" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MAIN';
