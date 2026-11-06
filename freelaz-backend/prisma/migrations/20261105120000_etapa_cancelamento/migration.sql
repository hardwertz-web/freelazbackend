-- Etapa cancelamento: campos de auditoria/multa no Hiring + flag de avaliação automática
ALTER TABLE "Hiring" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Hiring" ADD COLUMN "cancelOrigin" TEXT;
ALTER TABLE "Hiring" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "Hiring" ADD COLUMN "cancellationFeeCents" INTEGER;
ALTER TABLE "Hiring" ADD COLUMN "cancellationFeePercent" INTEGER;

ALTER TABLE "Evaluation" ADD COLUMN "isAutomatic" BOOLEAN NOT NULL DEFAULT false;
