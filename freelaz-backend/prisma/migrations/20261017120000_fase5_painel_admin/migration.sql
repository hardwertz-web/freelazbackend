-- Fase 5 — painel administrativo.
-- 1. Novo papel ADMIN (atribuído manualmente, nunca por auto-cadastro).
ALTER TYPE "UserRole" ADD VALUE 'ADMIN';

-- 2. Auditoria de identidade: quem decidiu a aprovação/rejeição.
ALTER TABLE "IdentityVerification" ADD COLUMN "decidedById" TEXT;
