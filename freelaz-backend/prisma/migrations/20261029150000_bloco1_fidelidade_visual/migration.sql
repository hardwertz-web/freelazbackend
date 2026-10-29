-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "eventTag" TEXT;
