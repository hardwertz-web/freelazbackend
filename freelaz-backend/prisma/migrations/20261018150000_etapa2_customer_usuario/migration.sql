-- Etapa 2 — cliente por usuário no Asaas (migração ADITIVA: só cria coluna e
-- índice; nenhum dado existente é alterado ou removido).
--
-- Motivo: o POST /payments do Asaas exige o campo `customer` (documentado em
-- docs.asaas.com > Criar nova cobrança). O id é criado via POST /customers na
-- primeira cobrança de cada usuário e persistido aqui para reutilização.

-- Alterar tabela
ALTER TABLE "User" ADD COLUMN "asaasCustomerId" TEXT;

-- Criar índice único
CREATE UNIQUE INDEX "User_asaasCustomerId_key" ON "User"("asaasCustomerId");
