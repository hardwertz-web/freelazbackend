-- Etapa 7.3c.1 - companyType da subconta PJ (opcional; PF nao envia).
-- Migracao ADITIVA: 1 coluna nullable. Nenhum dado e reescrito.
ALTER TABLE "User" ADD COLUMN "companyType" TEXT;
