// Executa a transição de status REAL de uma contratação — o mesmo caminho que
// o webhook do Asaas faz quando o pagamento é confirmado: vaga PREENCHIDA,
// status RETIDO e RETENCAO no ledger NA MESMA transação (com trava de linha).
//
// Por que este arquivo existe: o webhook completo precisa do token de webhook
// (o teste da Fase 4 envia direto pela rota HTTP); este sim fica para
// transições ISOLADAS via serviços compilados (tsc -> JS) e chamando as
// funções de verdade com um PrismaClient real — sem forjar nada no banco à
// mão. Espelhar só o status sem o ledger faria a reconciliação diária acusar
// "pagamento confirmado sem RETENCAO" (invariante 4).
//
// Uso:
//   node fase2-service-sim.js <backendDir> <hiringService.js> <hiringId> <novoStatus> [providerPaymentId]
const path = require("path");

const [, , backendDir, compiledServicePath, hiringId, nextStatus, providerPaymentId] = process.argv;

if (!backendDir || !compiledServicePath || !hiringId || !nextStatus) {
  console.error("argumentos ausentes");
  process.exit(2);
}

const { PrismaClient } = require(path.join(backendDir, "node_modules", "@prisma/client"));
const compiled = path.resolve(compiledServicePath);
const { setHiringStatus, lockHiringForUpdate } = require(compiled);
const { recordRetention } = require(path.join(path.dirname(compiled), "ledgerService.js"));

const prisma = new PrismaClient();

(async () => {
  try {
    let status;
    let retentionCents = 0;

    if (nextStatus === "RETIDO") {
      // Mesma sequência do webhook do Asaas (rota /api/webhooks/asaas):
      // trava a linha, some a vaga do marketplace, muda o status e grava a
      // retenção no ledger — tudo na MESMA transação.
      const outcome = await prisma.$transaction(async (tx) => {
        const locked = await lockHiringForUpdate(tx, hiringId);
        if (!locked) return { notFound: true };
        if (locked.status !== "AGUARDANDO_PAGAMENTO") {
          return { alreadyProcessed: true, status: locked.status };
        }
        await tx.jobPosting.update({
          where: { id: locked.jobPostingId },
          data: { status: "PREENCHIDA" },
        });
        await setHiringStatus(tx, hiringId, "RETIDO", providerPaymentId ? { providerPaymentId } : {});
        await recordRetention(hiringId, locked.grossValueCents, tx);
        return { ok: true, status: "RETIDO", retentionCents: locked.grossValueCents };
      });
      if (outcome.notFound) throw new Error("contratação não encontrada");
      status = outcome.status;
      retentionCents = outcome.retentionCents || 0;
    } else {
      const hiring = await setHiringStatus(
        prisma,
        hiringId,
        nextStatus,
        providerPaymentId ? { providerPaymentId } : {}
      );
      status = hiring.status;
    }

    const chat = await prisma.chat.findUnique({ where: { hiringId } });
    console.log(
      JSON.stringify({
        ok: true,
        status,
        retentionCents,
        chatStatus: chat ? chat.status : null,
        openedAt: Boolean(chat && chat.openedAt),
        closedAt: Boolean(chat && chat.closedAt),
      })
    );
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  } finally {
    await prisma.$disconnect();
  }
})();
