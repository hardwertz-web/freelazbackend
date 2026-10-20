// Executa o caminho REAL do webhook "pagamento aprovado" (ou uma transição de
// status isolada) para uma contratação, usando os serviços compilados do
// projeto — nunca uma escrita forjada no banco.
//
// Por que este arquivo existe: o webhook do Asaas valida um token de
// webhook (que o teste da Fase 4 envia direto pela rota HTTP); este sim
// replica o MESMO caminho de serviço (lock + RETIDO + retenção na mesma
// transação) para os fluxos que precisam chegar a RETIDO/CONCLUIDO sem
// depender do corpo do webhook, compilando os serviços TypeScript para
// CommonJS (via tsc) e chamando as funções de verdade com PrismaClient real.
//
// Uso:
//   node fase3-sim.js <backendDir> <compiledDir> <comando> <hiringId> [extra]
//
//   comando = "retido"  -> replica o passo "payment confirmed" do webhook:
//                          vaga PREENCHIDA + setHiringStatus(RETIDO) com
//                          providerPaymentId=extra + recordRetention(bruto),
//                          tudo na MESMA transação (como no webhook real).
//   comando = "status"  -> só a transição de status (extra = novo status),
//                          sem tocar no ledger (para avançar a contratação
//                          até CONCLUIDO quando o teste não precisa dos códigos).
const path = require("path");

const [, , backendDir, compiledDir, command, hiringId, extra] = process.argv;

if (!backendDir || !compiledDir || !command || !hiringId) {
  console.error("argumentos ausentes");
  process.exit(2);
}

const { PrismaClient } = require(path.join(backendDir, "node_modules", "@prisma/client"));
const { setHiringStatus } = require(path.join(compiledDir, "services", "hiringService.js"));
const { recordRetention } = require(path.join(compiledDir, "services", "ledgerService.js"));

const prisma = new PrismaClient();

(async () => {
  let ok = false;
  try {
    let hiring;

    if (command === "retido") {
      const providerPaymentId = extra || undefined;
      hiring = await prisma.$transaction(async (tx) => {
        const current = await tx.hiring.findUnique({ where: { id: hiringId } });
        if (!current) throw new Error("contratação não encontrada");
        // Passo 6 do fluxo: a vaga some do marketplace na aprovação do pagamento.
        await tx.jobPosting.update({
          where: { id: current.jobPostingId },
          data: { status: "PREENCHIDA" },
        });
        const updated = await setHiringStatus(
          tx,
          hiringId,
          "RETIDO",
          providerPaymentId ? { providerPaymentId } : {}
        );
        // O lançamento roda na MESMA transação do status (como no webhook).
        await recordRetention(hiringId, current.grossValueCents, tx);
        return updated;
      });
    } else if (command === "status") {
      hiring = await setHiringStatus(prisma, hiringId, extra);
    } else {
      throw new Error(`comando desconhecido: ${command}`);
    }

    const chat = await prisma.chat.findUnique({ where: { hiringId } });
    console.log(
      JSON.stringify({
        ok: true,
        status: hiring.status,
        chatStatus: chat ? chat.status : null,
        openedAt: Boolean(chat && chat.openedAt),
        closedAt: Boolean(chat && chat.closedAt),
      })
    );
    ok = true;
  } catch (err) {
    console.log(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    );
  } finally {
    await prisma.$disconnect();
    process.exitCode = ok ? 0 : 1;
  }
})();
