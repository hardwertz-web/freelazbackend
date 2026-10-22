-- Etapa 7.3d - modelo de taxa "empresa paga tudo" (custodia, sem subcontas).
-- Migracao ADITIVA: 1 valor de enum, 1 coluna com default e 3 colunas nullable.
-- Backfill explicito: todas as contratacoes existentes ficam LEGACY.
--
-- O novo lancamento RECEITA_PLATAFORMA e a receita da empresa (comissao + taxa
-- de saque estimada) no modelo NEW: nunca entra em computeRetainedBalance.
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'RECEITA_PLATAFORMA';

ALTER TABLE "Hiring" ADD COLUMN "taxModel" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "Hiring" ADD COLUMN "serviceFeeCents" INTEGER;
ALTER TABLE "Hiring" ADD COLUMN "estimatedWithdrawalFeeCents" INTEGER;
ALTER TABLE "Hiring" ADD COLUMN "totalChargedCents" INTEGER;

UPDATE "Hiring" SET "taxModel" = 'LEGACY' WHERE "taxModel" IS NULL;
