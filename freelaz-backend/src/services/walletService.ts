import { prisma } from "../lib/prisma";

/**
 * Carteira do profissional — leitura pura, calculada a partir das contratações
 * e dos Payouts (nunca de um "saldo" guardado solto numa tabela, que poderia
 * divergir da realidade). É a mesma filosofia do ledger: saldo é sempre soma.
 *
 * Conceitos:
 *  - aReceberCents: dinheiro já em retenção, mas de um serviço ainda em
 *    andamento (RETIDO/EM_ANDAMENTO/EM_DISPUTA). Não dá para sacar.
 *  - disponivelCents: serviço CONCLUIDO e ainda não repassado — é o que pode
 *    ser pago no lote semanal ou sacado na hora (com taxa).
 *  - emProcessamentoCents: repasse já disparado, aguardando o provedor.
 *  - sacadoCents: total já transferido para a chave Pix do profissional.
 */

// Serviços com dinheiro retido e que ainda não permitem saque.
const EM_ANDAMENTO_STATUSES = ["RETIDO", "EM_ANDAMENTO", "EM_DISPUTA"];

export type WalletSummary = {
  aReceberCents: number;
  disponivelCents: number;
  emProcessamentoCents: number;
  sacadoCents: number;
};

export async function getProfessionalWallet(professionalId: string): Promise<WalletSummary> {
  const hirings = await prisma.hiring.findMany({
    where: { professionalId },
    include: { payout: true },
  });

  let aReceberCents = 0;
  let disponivelCents = 0;
  let emProcessamentoCents = 0;
  let sacadoCents = 0;

  for (const hiring of hirings) {
    const payout = hiring.payout;

    if (EM_ANDAMENTO_STATUSES.includes(hiring.status)) {
      aReceberCents += hiring.netValueCents;
      continue;
    }

    if (hiring.status === "CONCLUIDO") {
      // Etapa 7.3d: NEW paga 100% do bruto ao profissional; LEGACY paga o
      // líquido. (Em NEW netValueCents == grossValueCents por construção, mas
      // ler gross deixa a regra explícita e à prova de dados legados.)
      const payableCents =
        hiring.taxModel === "NEW" ? hiring.grossValueCents : hiring.netValueCents;
      if (!payout || payout.status === "FALHOU") {
        disponivelCents += payableCents;
      } else if (payout.status === "PENDENTE" || payout.status === "PROCESSANDO") {
        emProcessamentoCents += payout.amountCents;
      } else if (payout.status === "CONCLUIDO") {
        sacadoCents += payout.amountCents;
      }
      continue;
    }

    // LIBERADO (terminal): o que importa é o Payout já concluído.
    if (payout?.status === "CONCLUIDO") sacadoCents += payout.amountCents;
  }

  return { aReceberCents, disponivelCents, emProcessamentoCents, sacadoCents };
}

export type StatementItem = {
  date: string; // ISO — ordena o extrato
  kind: "CREDITO" | "TRANSFERENCIA";
  label: string;
  hiringId: string;
  amountCents: number;
  feeCents?: number; // só em TRANSFERENCIA (desconto do saque instantâneo)
  status?: string; // status do Payout (só em TRANSFERENCIA)
};

/**
 * Extrato: dois tipos de evento, do ponto de vista do profissional —
 *  - CREDITO: o pagamento da empresa foi garantido (retenção), com o valor
 *    LÍQUIDO que é dele (o bruto menos a comissão já sai do lado da empresa);
 *  - TRANSFERENCIA: o repasse para a chave Pix, com status e taxa.
 */
export async function getProfessionalStatement(
  professionalId: string,
  limit = 30
): Promise<StatementItem[]> {
  const hirings = await prisma.hiring.findMany({
    where: { professionalId },
    select: {
      id: true,
      jobTitle: true,
      netValueCents: true,
      payout: true,
      ledgerEntries: {
        where: { type: "RETENCAO" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  const items: StatementItem[] = [];

  for (const hiring of hirings) {
    const retention = hiring.ledgerEntries[0];
    if (retention) {
      items.push({
        date: retention.createdAt.toISOString(),
        kind: "CREDITO",
        label: `Pagamento garantido — ${hiring.jobTitle}`,
        hiringId: hiring.id,
        amountCents: hiring.netValueCents,
      });
    }
    if (hiring.payout) {
      items.push({
        date: hiring.payout.createdAt.toISOString(),
        kind: "TRANSFERENCIA",
        label: `Repasse — ${hiring.jobTitle}`,
        hiringId: hiring.id,
        amountCents: hiring.payout.amountCents,
        feeCents: hiring.netValueCents - hiring.payout.amountCents,
        status: hiring.payout.status,
      });
    }
  }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items.slice(0, limit);
}
