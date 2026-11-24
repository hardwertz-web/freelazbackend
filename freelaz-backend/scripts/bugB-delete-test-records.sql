-- ATENÇÃO: script DESTRUTIVO. Roda APENAS com aprovação explícita.
--
-- 1) DRY-RUN primeiro: rodar o SELECT, colar output para revisão.
-- 2) Só depois, rodar o DELETE.
--
-- Alvo: IdentityVerification + arquivos R2 dos registros de TESTE
-- em prod. NÃO tocar em registros de usuário real.

-- Dry-run:
-- NOTA: o schema não tem "createdAt" em IdentityVerification; o campo
-- equivalente é "submittedAt" (confirmado no PASSO 0.9 e no banco DEV).
SELECT id, "userId", status, "documentUrl", "selfieUrl", "submittedAt"
FROM "IdentityVerification"
WHERE "documentUrl" IS NOT NULL OR "selfieUrl" IS NOT NULL
ORDER BY "submittedAt" DESC;

-- (usuário confirma quais registros são de teste)

-- Delete (após aprovação explícita):
-- BEGIN;
-- DELETE FROM "IdentityVerification" WHERE id IN ('<id1>', '<id2>');
-- COMMIT;
--
-- Os arquivos no R2 serão órfãos após o delete. Não usar
-- deleteFromR2 automaticamente (a chave não é recuperável no
-- DELETE, precisa de SELECT anterior + delete s3 para cada).
-- Deixar órfão é aceitável (R2 cobra por byte, mas 2 arquivos de
-- ~2MB é centavos).
