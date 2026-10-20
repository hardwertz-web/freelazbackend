-- Etapa 1 — idempotência de cobrança (correção autorizada).
--
-- Impacto: 100% aditivo. Cria a tabela ChargeAttempt (controle de tentativas
-- de cobrança no provedor — a trava atômica contra duplicidade em concorrência)
-- e o índice único JobBoost_jobPostingId_key (um boost por vaga, regra que o
-- código já aplicava em nível de aplicação). Nenhuma tabela existente é alterada
-- e nenhum registro é excluído.
--
-- Reversão (sem perda de dados, pois só remove estrutura nova):
--   DROP TABLE "ChargeAttempt";
--   DROP INDEX "JobBoost_jobPostingId_key";

-- 1) Etapa 1 — tentativas de cobrança por operação ---------------------------

CREATE TABLE "ChargeAttempt" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROVIDER_UNCONFIRMED',
    "providerPaymentId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChargeAttempt_pkey" PRIMARY KEY ("id")
);

-- A trava atômica: duas requisições concorrentes disputam o mesmo número de
-- tentativa; só uma consegue inserir, a outra recebe violação de unicidade.
CREATE UNIQUE INDEX "ChargeAttempt_entity_entityId_attempt_key" ON "ChargeAttempt"("entity", "entityId", "attempt");

CREATE UNIQUE INDEX "ChargeAttempt_providerPaymentId_key" ON "ChargeAttempt"("providerPaymentId");

CREATE INDEX "ChargeAttempt_entity_entityId_idx" ON "ChargeAttempt"("entity", "entityId");

-- 2) Etapa 1 — um boost por vaga garantido pelo banco ------------------------

CREATE UNIQUE INDEX "JobBoost_jobPostingId_key" ON "JobBoost"("jobPostingId");
