import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { selectCandidate } from "@/services/jobPostingService";
import { requireUser, hasActiveRole } from "@/lib/auth";

/**
 * POST /api/jobs/:id/select
 * Body: { applicationId }
 * A empresa escolhe um candidato. Os demais candidatos PENDENTES dessa
 * vaga viram SUPLENTE automaticamente (ver jobPostingService).
 * Só o contratante dono da vaga pode selecionar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const { applicationId } = await req.json();
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId é obrigatório" }, { status: 400 });
  }

  // A candidatura precisa pertencer à vaga da URL E a uma vaga deste usuário
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { jobPosting: true },
  });
  if (!application || application.jobPostingId !== params.id) {
    return NextResponse.json({ error: "Candidatura não encontrada nesta vaga" }, { status: 404 });
  }
  if (application.jobPosting.contractorId !== user.id || !hasActiveRole(user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Apenas a empresa dona da vaga pode selecionar candidatos" }, { status: 403 });
  }

  try {
    const selected = await selectCandidate(applicationId);
    return NextResponse.json({ selected: true, application: selected });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
