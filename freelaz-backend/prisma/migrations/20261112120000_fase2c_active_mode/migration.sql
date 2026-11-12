-- Fase 2c: modo ativo do usuário
CREATE TYPE "ActiveMode" AS ENUM ('PROFISSIONAL', 'CONTRATANTE', 'BOTH');
ALTER TABLE "User" ADD COLUMN "activeMode" "ActiveMode" NOT NULL DEFAULT 'PROFISSIONAL';
