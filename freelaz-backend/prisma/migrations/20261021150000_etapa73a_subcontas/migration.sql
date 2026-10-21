-- Etapa 7.3a — FUNDAÇÃO de subcontas Asaas.
-- Migração ADITIVA: só adiciona 3 colunas nullable em "User". Nenhum dado
-- existente é alterado e nada em produção lê/escreve estes campos ainda.
ALTER TABLE "User" ADD COLUMN "asaasSubaccountId" TEXT;
ALTER TABLE "User" ADD COLUMN "asaasSubaccountApiKey" TEXT;
ALTER TABLE "User" ADD COLUMN "asaasSubaccountStatus" TEXT;
