import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listSubstitutes, selectCandidate } from "@/services/jobPostingService";
import { requireUser, hasActiveRole } from "@/lib/auth";

/** Só o contratante dono da vaga enxerga e retoma a lista de suplentes. */
async function requireJobOwner(jobId: string, userId: string) {
  const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
  if (!job) {
    return { job: null, error: { status: 404, body: { error: "Vaga não encontrada" } } };
  }
  if (job.contractorId !== userId) {
    return {
      job: null,
      error: { status: 403, body: { error: "Apenas a empresa dona da vaga pode retomá-la" } },
    };
  }
  return { job, error: undefined };
}

/**
 * GET /api/jobs/:id/resume
 * Botão "Retomar vaga" — retorna a lista de suplentes para a empresa
 * escolher diretamente, sem precisar recriar a vaga do zero.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const job = await requireJobOwner(params.id, auth.user.id);
  if (job.error) return NextResponse.json(job.error.body, { status: job.error.status });

  const substitutes = await listSubstitutes(params.id);
  return NextResponse.json({ substitutes });
}

/**
 * POST /api/jobs/:id/resume
 * Body: { applicationId }
 * Seleciona diretamente um suplente da lista — mesma lógica de seleção
 * normal (os demais continuam/voltam a ser suplentes).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const job = await requireJobOwner(params.id, auth.user.id);
  if (job.error) return NextResponse.json(job.error.body, { status: job.error.status });

  const { applicationId } = await req.json();
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId é obrigatório" }, { status: 400 });
  }

  const application = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!application || application.jobPostingId !== params.id) {
    return NextResponse.json({ error: "Candidatura não encontrada nesta vaga" }, { status: 404 });
  }

  try {
    const selected = await selectCandidate(applicationId);
    return NextResponse.json({ resumed: true, application: selected });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
