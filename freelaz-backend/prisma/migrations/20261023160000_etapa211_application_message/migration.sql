-- Etapa 2.1.1 - mensagem opcional na candidatura.
-- Migracao ADITIVA: 1 coluna nullable, sem backfill e sem default.
-- O limite de 500 caracteres e validado na rota /api/jobs/:id/apply; o CHECK
-- abaixo garante a mesma regra para qualquer escrita fora dela (NULL = sem
-- mensagem, permitido).
ALTER TABLE "Application" ADD COLUMN "message" TEXT;

ALTER TABLE "Application"
  ADD CONSTRAINT "Application_message_length_check"
  CHECK ("message" IS NULL OR char_length("message") BETWEEN 1 AND 500);
