import type { Db } from "../lib/db";

/**
 * Confiabilidade — MÉTRICA SEPARADA DA NOTA de estrelas (decisão de
 * produto, task_plan Fase 4). Fórmula acordada:
 *
 *   confiabilidade = (serviços finalizados LIMPOS ÷ serviços finalizados) × 100
 *
 * sobre as últimas 20 contratações finalizadas. "Finalizado" = status
 * terminal (LIBERADO ou CANCELADO — EM_DISPUTA ainda não conta). "Limpo" =
 * terminou LIBERADO (serviço executado e repassado); cancelamento conta como
 * sujo, porque o cancelamento é o caminho único de interrupção (desistência,
 * falta ou desacordo — ver matchService).
 *
 * O resultado é GRAVADO em ProfessionalProfile.reliabilityScore (ex. 98.0) e
 * recalculado a cada transição para estado terminal (chamado por
 * hiringService.setHiringStatus) — nunca "estimado" no momento da leitura.
 */

const RELIABILITY_WINDOW = 20; // últimas N contratações finalizadas

export async function refreshProfessionalReliability(
  db: Db,
  professionalId: string
): Promise<number | null> {
  const recent = await db.hiring.findMany({
    where: { professionalId, status: { in: ["LIBERADO", "CANCELADO"] } },
    orderBy: { updatedAt: "desc" },
    take: RELIABILITY_WINDOW,
    select: { status: true },
  });

  const score =
    recent.length === 0
      ? null
      : Math.round(
          (recent.filter((h) => h.status === "LIBERADO").length / recent.length) * 1000
        ) / 10; // uma casa decimal: 98.0, 75.0...

  // upsert defensivo: o perfil Profissional nasce no cadastro, mas contas
  // antigas/diretas no banco podem não ter — nunca quebrar por isso.
  await db.professionalProfile.upsert({
    where: { userId: professionalId },
    create: { userId: professionalId, reliabilityScore: score },
    update: { reliabilityScore: score },
  });

  return score;
}
