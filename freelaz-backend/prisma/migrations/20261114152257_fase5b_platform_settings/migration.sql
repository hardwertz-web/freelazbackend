-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE 'SETTING_CHANGED';

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'int',
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- Seed das configurações financeiras (Fase 5b). Defaults de fábrica — o
-- painel pode alterar depois; ON CONFLICT preserva valores já editados.
INSERT INTO "PlatformSetting" (key, value, type, description, "createdAt", "updatedAt") VALUES
  ('commission_bps', '1000', 'int', 'Comissão da plataforma em basis points (1000 = 10%)', now(), now()),
  ('boost_price_cents', '1000', 'int', 'Preço do impulsionamento (R$ 10,00)', now(), now()),
  ('withdrawal_fee_bps', '100', 'int', 'Taxa do saque instantâneo em basis points (100 = 1%)', now(), now())
ON CONFLICT (key) DO NOTHING;
