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
 *  - uma candidatura por profissional/vaga (garantido pelo @@unique do banco);
 *  - a mensagem é opcional (1-500 chars): ausente/null/vazia grava NULL.
 *
 * Vaga PRIVADA ("Me contrate") não passa por aqui: a candidatura dela já
 * nasce junto do convite, em /api/jobs/invite.
 */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Valida `message` sem nunca logar o conteúdo (só o tamanho importa).
 * `undefined`/`null`/string vazia = candidatura sem recado.
 */
function parseMessage(raw: unknown): { value: string | null; error?: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") {
    return { value: null, error: "Mensagem deve ser um texto" };
  }
  const text = raw.trim();
  if (!text) return { value: null };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { value: null, error: `Mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres` };
  }
  return { value: text };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  let payload: Record<string, unknown> = {};
  const rawBody = await req.text();
  if (rawBody.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
  }

  const message = parseMessage(payload.message);
  if (message.error) {
    return NextResponse.json({ error: message.error }, { status: 422 });
  }

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
        message: message.value,
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
