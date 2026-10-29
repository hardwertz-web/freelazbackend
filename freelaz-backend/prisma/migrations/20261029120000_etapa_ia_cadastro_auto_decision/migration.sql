-- CreateEnum
-- (none)

-- AlterTable
ALTER TABLE "IdentityVerification" ADD COLUMN "autoDecision" TEXT,
ADD COLUMN "reviewReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "autoConfidence" DOUBLE PRECISION;
