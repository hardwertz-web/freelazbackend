-- CreateEnum
CREATE TYPE "CompanyWalletEntryType" AS ENUM ('REFUND_CREDIT', 'HIRING_DEBIT', 'WITHDRAWAL_DEBIT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CompanyWalletEntry" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "hiringId" TEXT,
    "type" "CompanyWalletEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyWalletEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWalletEntry_idempotencyKey_key" ON "CompanyWalletEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CompanyWalletEntry_contractorId_createdAt_idx" ON "CompanyWalletEntry"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyWalletEntry_hiringId_idx" ON "CompanyWalletEntry"("hiringId");

-- AddForeignKey
ALTER TABLE "CompanyWalletEntry" ADD CONSTRAINT "CompanyWalletEntry_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWalletEntry" ADD CONSTRAINT "CompanyWalletEntry_hiringId_fkey" FOREIGN KEY ("hiringId") REFERENCES "Hiring"("id") ON DELETE SET NULL ON UPDATE CASCADE;
