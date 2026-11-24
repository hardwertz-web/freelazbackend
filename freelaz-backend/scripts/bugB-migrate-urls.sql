-- Migração: documentUrl/selfieUrl começando com "https://" →
-- relativePath. Só para IdentityVerification (documents sensíveis).
-- Avatares NÃO migram (são públicos).
--
-- Formato de URL em R2: https://pub-xxx.r2.dev/<key>
--   onde <key> = "verifications/<userId>/<file>"
-- O R2_PUBLIC_URL está no .env — usar replace com regexp.
--
-- IDEMPOTENTE: se documentUrl não começar com "https://", fica
-- intacto.

BEGIN;

UPDATE "IdentityVerification"
SET "documentUrl" = regexp_replace("documentUrl", '^https?://[^/]+/', '')
WHERE "documentUrl" LIKE 'https://%'
   OR "documentUrl" LIKE 'http://%';

UPDATE "IdentityVerification"
SET "selfieUrl" = regexp_replace("selfieUrl", '^https?://[^/]+/', '')
WHERE "selfieUrl" LIKE 'https://%'
   OR "selfieUrl" LIKE 'http://%';

COMMIT;

-- Verificação pós (rodar separado):
-- SELECT COUNT(*) FROM "IdentityVerification"
-- WHERE "documentUrl" LIKE 'http://%' OR "documentUrl" LIKE 'https://%';
