import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";

/**
 * POST /api/jobs/:id/reopen — Backlog #3, botão "Retomar vaga".
 *
 * Reabre uma vaga CANCELADA (soft delete do DELETE /api/jobs/:id) voltando
 * para ABERTA reaproveitando a mesma vaga, candidaturas e suplentes.
 *
 * Guardas:
 * - só o contratante dono da vaga (403);
 * - só a partir de CANCELADA (409) — reabrir ABERTA/PREENCHIDA/EXPIRADA não é
 *   o que o botão promete;
 * - `endsAt` precisa estar no futuro (409): uma vaga vencida voltaria ao
 *   marketplace público e sumiria no mesmo instante (o `GET /api/jobs` filtra
 *   `endsAt >= now`), parecendo bug para quem publicou.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const job = await prisma.jobPosting.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  }
  if (job.contractorId !== auth.user.id) {
    return NextResponse.json(
      { error: "Apenas a empresa dona da vaga pode reabri-la" },
      { status: 403 }
    );
  }
  if (job.status !== "CANCELADA") {
    return NextResponse.json(
      { error: `Só é possível retomar vaga CANCELADA (status atual: ${job.status})` },
      { status: 409 }
    );
  }
  if (job.endsAt <= new Date()) {
    return NextResponse.json(
      { error: "Esta vaga já passou do prazo de término — publique uma nova vaga" },
      { status: 409 }
    );
  }

  const updated = await prisma.jobPosting.update({
    where: { id: job.id },
    data: { status: "ABERTA" },
    select: { id: true, title: true, status: true, endsAt: true },
  });

  return NextResponse.json({ jobPosting: updated });
}
