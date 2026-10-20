import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole, getCurrentUser } from "@/lib/auth";
import { parseJobFields } from "@/lib/jobInput";
import { jobCard, jobCardSelect } from "@/lib/jobPublic";
import { hasActiveHiring } from "@/services/hiringService";

/**
 * Carrega a vaga + valida se o usuário é o dono.
 * Devolve o erro HTTP pronto, no padrão `{ error: string }`.
 */
async function requireJobOwner(jobId: string, userId: string) {
  const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
  if (!job) {
    return { job: null, error: { status: 404, body: { error: "Vaga não encontrada" } } };
  }
  if (job.contractorId !== userId) {
    return {
      job: null,
      error: { status: 403, body: { error: "Apenas a empresa dona da vaga pode alterá-la" } },
    };
  }
  return { job, error: undefined };
}

/**
 * GET /api/jobs/:id — detalhe público de uma vaga.
 * Vaga PÚBLICA: aberta a qualquer um. Vaga PRIVADA ("Me contrate"): só o
 * dono e o profissional alvo enxergam — senão qualquer profissional poderia
 * descobrir propostas feitas a outros.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const job = await prisma.jobPosting.findUnique({
    where: { id: params.id },
    select: {
      ...jobCardSelect,
      targetProfessionalId: true,
      contractorId: true,
      _count: { select: { applications: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });

  const viewer = await getCurrentUser();

  if (job.visibility === "PRIVADA") {
    const allowed =
      viewer && (viewer.id === job.contractorId || viewer.id === job.targetProfessionalId);
    if (!allowed) {
      return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
    }
  }

  // Não vaza ids internos de vaga privada para quem não é dono/alvo.
  const isOwner = viewer?.id === job.contractorId;

  return NextResponse.json({
    jobPosting: {
      ...jobCard(job),
      targetProfessionalId: isOwner ? job.targetProfessionalId : undefined,
      applicationsCount: job._count.applications,
    },
  });
}

/**
 * PATCH /api/jobs/:id — edita uma vaga ainda ABERTA e sem contratação viva.
 * Editar valor/horário depois de alguém já ter sido selecionado mudaria o que
 * foi acordado — por isso o bloqueio quando existe Hiring em andamento.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const owner = await requireJobOwner(params.id, auth.user.id);
  if (owner.error) return NextResponse.json(owner.error.body, { status: owner.error.status });
  const job = owner.job!;

  if (job.status !== "ABERTA") {
    return NextResponse.json(
      { error: `Só é possível editar vaga ABERTA (status atual: ${job.status})` },
      { status: 409 }
    );
  }
  if (await hasActiveHiring(prisma, job.id)) {
    return NextResponse.json(
      { error: "Esta vaga já tem uma contratação em andamento e não pode ser editada" },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = parseJobFields(body, true);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  // Datas: o helper só compara quando os DOIS extremos vêm no payload. Aqui
  // completamos com o valor já salvo para rejeitar "fim antes do início"
  // quando só um dos lados é enviado.
  const startsAt = parsed.data.startsAt ?? job.startsAt;
  const endsAt = parsed.data.endsAt ?? job.endsAt;
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "O fim do turno deve ser depois do início" }, { status: 422 });
  }

  const updated = await prisma.jobPosting.update({
    where: { id: job.id },
    data: parsed.data,
    select: jobCardSelect,
  });

  return NextResponse.json({ jobPosting: jobCard(updated) });
}

/**
 * DELETE /api/jobs/:id — encerra a vaga (status CANCELADA, soft delete).
 * Não apagamos o registro: a vaga é referenciada por candidaturas/contratações
 * e o histórico precisa sobreviver (mesmo princípio do "nunca editar, sempre
 * criar um novo lançamento" do ledger).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const owner = await requireJobOwner(params.id, auth.user.id);
  if (owner.error) return NextResponse.json(owner.error.body, { status: owner.error.status });
  const job = owner.job!;

  if (await hasActiveHiring(prisma, job.id)) {
    return NextResponse.json(
      { error: "Esta vaga tem uma contratação em andamento — cancele a contratação primeiro" },
      { status: 409 }
    );
  }

  const updated = await prisma.jobPosting.update({
    where: { id: job.id },
    data: { status: "CANCELADA" },
    select: jobCardSelect,
  });

  return NextResponse.json({ jobPosting: jobCard(updated) });
}
