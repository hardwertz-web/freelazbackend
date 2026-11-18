-- CreateEnum
CREATE TYPE "CompanyWithdrawalStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "CompanyWithdrawal" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "pixKey" TEXT NOT NULL,
    "status" "CompanyWithdrawalStatus" NOT NULL DEFAULT 'PROCESSING',
    "providerTransferId" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWithdrawal_providerTransferId_key" ON "CompanyWithdrawal"("providerTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWithdrawal_idempotencyKey_key" ON "CompanyWithdrawal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CompanyWithdrawal_contractorId_createdAt_idx" ON "CompanyWithdrawal"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyWithdrawal_contractorId_status_idx" ON "CompanyWithdrawal"("contractorId", "status");

-- AddForeignKey
ALTER TABLE "CompanyWithdrawal" ADD CONSTRAINT "CompanyWithdrawal_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
