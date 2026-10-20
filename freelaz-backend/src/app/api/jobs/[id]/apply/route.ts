import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { hasActiveHiring } from "@/services/hiringService";

/**
 * POST /api/jobs/:id/apply — candidatura a uma vaga PÚBLICA.
 *
 * Regras:
 *  - o profissional precisa ter o papel Profissional ATIVO (papel PENDENTE
 *    não se candidata — ver findings.md > identidade e papéis);
 *  - a vaga precisa estar ABERTA, PÚBLICA e ainda no prazo;
 *  - o próprio contratante dono não pode se candidatar à própria vaga;
 *  - uma vaga com contratação em andamento está reservada (409);
 *  - uma candidatura por profissional/vaga (garantido pelo @@unique do banco).
 *
 * Vaga PRIVADA ("Me contrate") não passa por aqui: a candidatura dela já
 * nasce junto do convite, em /api/jobs/invite.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  if (!hasActiveRole(user, "PROFISSIONAL")) {
    return NextResponse.json(
      { error: "Ative o papel Profissional (verificação aprovada) para se candidatar" },
      { status: 403 }
    );
  }

  const job = await prisma.jobPosting.findUnique({ where: { id: params.id } });
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });

  if (job.visibility !== "PUBLICA") {
    return NextResponse.json(
      { error: "Esta vaga é privada — responda ao convite recebido" },
      { status: 403 }
    );
  }
  if (job.status !== "ABERTA") {
    return NextResponse.json({ error: "Esta vaga não está mais aberta" }, { status: 409 });
  }
  if (job.endsAt <= new Date()) {
    return NextResponse.json({ error: "Esta vaga já terminou" }, { status: 409 });
  }
  if (job.contractorId === user.id) {
    return NextResponse.json({ error: "Você não pode se candidatar à sua própria vaga" }, { status: 409 });
  }
  if (await hasActiveHiring(prisma, job.id)) {
    return NextResponse.json(
      { error: "Esta vaga já está reservada por outra contratação" },
      { status: 409 }
    );
  }

  try {
    const application = await prisma.application.create({
      data: {
        jobPostingId: job.id,
        professionalId: user.id,
        status: "PENDENTE",
      },
    });
    return NextResponse.json({ application }, { status: 201 });
  } catch (err) {
    // P2002 = violação do @@unique([jobPostingId, professionalId])
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json(
        { error: "Você já se candidatou a esta vaga" },
        { status: 409 }
      );
    }
    throw err;
  }
}
