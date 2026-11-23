-- Backfill idempotente: garante CONTRATANTE ATIVO + ContractorProfile
-- para todo usuário existente. Seguro rodar múltiplas vezes.
-- Rodar em prod ANTES de deployar o commit 1.
--
-- Ajustes conforme prisma/schema.prisma:
--   UserRoleAssignment.id / ContractorProfile.id são String @default(cuid())
--     → gerador 'c' + 24 hex (25 chars, formato compatível com cuid)
--   UserRoleAssignment tem @@unique([userId, role]) e activeAt @default(now())
--   ContractorProfile.userId é @unique, verificationStatus tem default
--     NAO_VERIFICADO e updatedAt (@updatedAt) NÃO tem default no banco
--     → precisa ser preenchido explicitamente no INSERT raw

BEGIN;

-- 0) Normaliza CONTRATANTE já existente mas não ATIVO (o default do schema é
--    ATIVO, mas registros antigos podem ter sido criados como PENDENTE).
UPDATE "UserRoleAssignment" r
SET status = 'ATIVO'
WHERE r.role = 'CONTRATANTE' AND r.status <> 'ATIVO';

-- 1) Cria UserRoleAssignment CONTRATANTE ATIVO para quem não tem
INSERT INTO "UserRoleAssignment" (id, "userId", role, status, "activeAt")
SELECT
  'c' || substr(md5(random()::text) || md5(random()::text), 1, 24),
  u.id,
  'CONTRATANTE',
  'ATIVO',
  NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "UserRoleAssignment" r
  WHERE r."userId" = u.id AND r.role = 'CONTRATANTE'
);

-- 2) Cria ContractorProfile para quem não tem
INSERT INTO "ContractorProfile" (id, "userId", "verificationStatus", "updatedAt")
SELECT
  'c' || substr(md5(random()::text) || md5(random()::text), 1, 24),
  u.id,
  'NAO_VERIFICADO',
  NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "ContractorProfile" cp WHERE cp."userId" = u.id
);

COMMIT;

-- Verificação (rodar depois):
-- SELECT COUNT(*) FROM "User" u
-- WHERE NOT EXISTS (
--   SELECT 1 FROM "UserRoleAssignment"
--   WHERE "userId" = u.id AND role = 'CONTRATANTE' AND status = 'ATIVO'
-- );
-- Deve retornar 0.
