-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE 'COMPANY_COMMISSION_CHANGED';

-- AlterTable
ALTER TABLE "ContractorProfile" ADD COLUMN     "customCommissionBps" INTEGER;
