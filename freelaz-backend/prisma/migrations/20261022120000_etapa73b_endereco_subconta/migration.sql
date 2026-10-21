-- Etapa 7.3b — endereço e renda para onboarding de subconta Asaas.
-- Migração ADITIVA: 5 colunas nullable em User. Nenhuma coluna/tabela
-- existente é alterada e nenhum dado é reescrito.
ALTER TABLE "User" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "User" ADD COLUMN "address" TEXT;
ALTER TABLE "User" ADD COLUMN "addressNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "province" TEXT;
ALTER TABLE "User" ADD COLUMN "incomeValueCents" INTEGER;
