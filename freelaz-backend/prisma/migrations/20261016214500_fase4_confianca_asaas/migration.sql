-- Fase 4 — confiança e segurança + migração do provedor de pagamento
-- (Mercado Pago -> Asaas, decisão humana registrada em findings.md).
--
-- IMPORTANTE: as colunas do provedor são RENOMEADAS (não dropadas+criadas)
-- para PRESERVAR os valores já gravados — o histórico financeiro nunca é
-- reescrito. Os índices únicos são renomeados junto para o Prisma não
-- acusar deriva de nome.

-- 1) Renomes do provedor de pagamento --------------------------------------

ALTER TABLE "Hiring" RENAME COLUMN "mpPaymentId" TO "providerPaymentId";
ALTER INDEX "Hiring_mpPaymentId_key" RENAME TO "Hiring_providerPaymentId_key";

ALTER TABLE "Payout" RENAME COLUMN "mpTransferId" TO "providerTransferId";
ALTER INDEX "Payout_mpTransferId_key" RENAME TO "Payout_providerTransferId_key";

ALTER TABLE "JobBoost" RENAME COLUMN "mpPaymentId" TO "providerPaymentId";
ALTER INDEX "JobBoost_mpPaymentId_key" RENAME TO "JobBoost_providerPaymentId_key";

-- A "preference" do Checkout Pro do Mercado Pago não existe no Asaas (o
-- pagamento Pix é criado direto, sem checkout hospedado) — coluna morta.
ALTER TABLE "Hiring" DROP COLUMN "mpPreferenceId";

-- 2) Fase 4 — avaliação mútua -----------------------------------------------

CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "hiringId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Evaluation_targetId_createdAt_idx" ON "Evaluation"("targetId", "createdAt");
CREATE UNIQUE INDEX "Evaluation_hiringId_authorId_key" ON "Evaluation"("hiringId", "authorId");

ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Faixa 1-5 de estrelas garantida também pelo banco, não só pela rota.
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5);

-- 3) Fase 4 — check-in por geolocalização ----------------------------------

CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "hiringId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckIn_hiringId_key" ON "CheckIn"("hiringId");

ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Fase 4 — auditoria/limite de tentativas de código ---------------------

CREATE TABLE "CodeAttempt" (
    "id" TEXT NOT NULL,
    "hiringId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "attemptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CodeAttempt_hiringId_kind_createdAt_idx" ON "CodeAttempt"("hiringId", "kind", "createdAt");

ALTER TABLE "CodeAttempt" ADD CONSTRAINT "CodeAttempt_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Fase 4 — disputa (canal + evidências + decisão administrativa) --------

CREATE TYPE "DisputeStatus" AS ENUM ('EM_ANALISE', 'RESOLVIDA');
CREATE TYPE "DisputeResolution" AS ENUM ('DEVOLUCAO_TOTAL', 'LIBERACAO_TOTAL', 'DIVISAO');

CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "hiringId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedBySide" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'EM_ANALISE',
    "resolution" "DisputeResolution",
    "splitPercentToProfessional" INTEGER,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Percentual do split também validado no banco (0-100 quando presente).
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_split_range" CHECK ("splitPercentToProfessional" IS NULL OR ("splitPercentToProfessional" >= 0 AND "splitPercentToProfessional" <= 100));

CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) Fase 4 — denúncia (fila separada e prioritária para ABUSO) ------------

CREATE TYPE "ReportCategory" AS ENUM ('ABUSO', 'FRAUDE', 'NAO_COMPARECEU', 'OUTRO');
CREATE TYPE "ReportStatus" AS ENUM ('ABERTA', 'EM_ANALISE', 'ACAO_TOMADA', 'ARQUIVADA');

CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "hiringId" TEXT,
    "category" "ReportCategory" NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'ABERTA',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Report_status_priority_createdAt_idx" ON "Report"("status", "priority", "createdAt");

ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7) Invariantes garantidas pelo PRÓPRIO banco -----------------------------
-- O Prisma não consegue expressar índices únicos parciais no schema — eles
-- vivem só aqui e protegem as invariantes mesmo sob corrida de requisições
-- simultâneas (duas seleções na mesma vaga, dois webhooks do mesmo pagamento,
-- duas disputas abertas na mesma contratação).

CREATE UNIQUE INDEX "Hiring_uma_contratacao_viva_por_vaga" ON "Hiring"("jobPostingId") WHERE "status" IN ('AGUARDANDO_PAGAMENTO', 'RETIDO', 'EM_ANDAMENTO', 'EM_DISPUTA', 'CONCLUIDO');

CREATE UNIQUE INDEX "LedgerEntry_uma_retencao_por_contratacao" ON "LedgerEntry"("hiringId") WHERE "type" = 'RETENCAO';

CREATE UNIQUE INDEX "Dispute_uma_disputa_aberta_por_contratacao" ON "Dispute"("hiringId") WHERE "status" = 'EM_ANALISE';
