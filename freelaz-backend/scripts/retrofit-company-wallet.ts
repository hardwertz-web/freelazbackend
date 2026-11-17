import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Retrofit histórico — cria CompanyWalletEntry para todos os REEMBOLSO do
 * ledger que ainda não têm crédito na carteira da empresa. Deve rodar UMA VEZ
 * após o deploy da Fase 2, para honrar o passivo acumulado desde o início.
 *
 * Idempotente: usa hiringId + type=REFUND_CREDIT como chave de deduplicação.
 */
async function main() {
  const refunds = await prisma.ledgerEntry.findMany({
    where: { type: "REEMBOLSO" },
    include: { hiring: { select: { contractorId: true, id: true } } },
  });

  console.log(`[retrofit] encontrados ${refunds.length} REEMBOLSO no ledger`);

  let created = 0;
  let skipped = 0;

  for (const refund of refunds) {
    const existing = await prisma.companyWalletEntry.findFirst({
      where: {
        hiringId: refund.hiringId,
        type: "REFUND_CREDIT",
      },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.companyWalletEntry.create({
      data: {
        contractorId: refund.hiring.contractorId,
        hiringId: refund.hiringId,
        type: "REFUND_CREDIT",
        amountCents: refund.amountCents,
        reason: `retrofit: ${refund.reason}`,
        createdBy: "system",
      },
    });
    created++;
  }

  console.log(`[retrofit] criados: ${created} | pulados (já existem): ${skipped}`);
}

main()
  .catch((err) => {
    console.error("[retrofit] falhou:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
