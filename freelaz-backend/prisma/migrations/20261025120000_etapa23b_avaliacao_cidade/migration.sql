-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "city" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- Backfill obrigatório (Fase 2.3b): todas as avaliações existentes já eram
-- visíveis antes da janela cega. Sem este UPDATE, `recalculateRating` (que
-- filtra `releasedAt != null`) zeraria a média de todo mundo.
UPDATE "Evaluation" SET "releasedAt" = "createdAt" WHERE "releasedAt" IS NULL;
