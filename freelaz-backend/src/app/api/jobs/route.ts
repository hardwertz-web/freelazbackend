import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { isJobModality, JOB_MODALITIES, parseJobFields } from "@/lib/jobInput";
import { jobCard, jobCardSelect } from "@/lib/jobPublic";

const MAX_PAGE_SIZE = 50;

/**
 * GET /api/jobs — marketplace público (não exige sessão).
 *
 * Só aparecem vagas PÚBLICAS, ABERTAS e que ainda não terminaram. A vaga sai
 * do ar quando o pagamento é confirmado (status PREENCHIDA é setado no
 * webhook, não aqui) — por isso este filtro é a fonte da verdade do que o
 * profissional vê.
 *
 * Filtros: q, category, modality, city, state, date (YYYY-MM-DD, fuso de
 * Brasília), minValueCents, maxValueCents, sort, page, limit.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") ?? "").trim();
  const category = (searchParams.get("category") ?? "").trim().toLowerCase();
  const modality = (searchParams.get("modality") ?? "").trim().toUpperCase();

  // Modalidade inválida é erro de cliente, não "sem filtro": devolver tudo
  // esconderia um bug de integração atrás de uma lista plausível.
  if (modality && !isJobModality(modality)) {
    return NextResponse.json(
      { error: `Modalidade deve ser uma de: ${JOB_MODALITIES.join(", ")}` },
      { status: 422 }
    );
  }

  const city = (searchParams.get("city") ?? "").trim();
  const state = (searchParams.get("state") ?? "").trim().toUpperCase();
  const date = (searchParams.get("date") ?? "").trim();
  const sort = (searchParams.get("sort") ?? "RELEVANCIA").toUpperCase();

  const minValueCents = Number.parseInt(searchParams.get("minValueCents") ?? "", 10);
  const maxValueCents = Number.parseInt(searchParams.get("maxValueCents") ?? "", 10);

  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20)
  );

  const where: Prisma.JobPostingWhereInput = {
    status: "ABERTA",
    visibility: "PUBLICA",
    endsAt: { gte: new Date() },
  };

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
    ];
  }
  if (category) where.category = category;
  if (modality) where.modality = modality;
  if (city || state) {
    where.contractor = {
      ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
      ...(state ? { state: { equals: state } } : {}),
    };
  }
  if (Number.isInteger(minValueCents) || Number.isInteger(maxValueCents)) {
    where.valueCents = {
      ...(Number.isInteger(minValueCents) ? { gte: minValueCents } : {}),
      ...(Number.isInteger(maxValueCents) ? { lte: maxValueCents } : {}),
    };
  }
  if (date) {
    // Interpretado no fuso de Brasília (UTC-3): o produto é uma plataforma
    // brasileira e "sábado" para o usuário não é o mesmo intervalo UTC.
    const start = new Date(`${date}T00:00:00.000-03:00`);
    if (!Number.isNaN(start.getTime())) {
      where.startsAt = { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
    }
  }

  const orderBy: Prisma.JobPostingOrderByWithRelationInput[] =
    sort === "PROXIMAS"
      ? [{ startsAt: "asc" }]
      : sort === "MAIOR_VALOR"
        ? [{ valueCents: "desc" }]
        : sort === "MENOR_VALOR"
          ? [{ valueCents: "asc" }]
          : sort === "RECENTES"
            ? [{ createdAt: "desc" }]
            : [{ urgentBoost: "desc" }, { createdAt: "desc" }]; // RELEVANCIA

  const [total, jobs] = await Promise.all([
    prisma.jobPosting.count({ where }),
    prisma.jobPosting.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: jobCardSelect,
    }),
  ]);

  return NextResponse.json({
    items: jobs.map(jobCard),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
}

/**
 * POST /api/jobs — publica uma vaga PÚBLICA no marketplace.
 * Só quem tem o papel Contratante ATIVO pode publicar. A vaga nasce ABERTA e
 * visível a todos; `visibility: PRIVADA` é uso exclusivo do "Me contrate"
 * (`/api/jobs/invite`), que não passa por aqui.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  if (!hasActiveRole(user, "CONTRATANTE")) {
    return NextResponse.json(
      { error: "Ative o papel Contratante para publicar uma vaga" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = parseJobFields(body, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const jobPosting = await prisma.jobPosting.create({
    data: {
      contractorId: user.id,
      visibility: "PUBLICA",
      status: "ABERTA",
      ...parsed.data,
    },
    select: jobCardSelect,
  });

  // TODO: notificar profissionais compatíveis (push/WhatsApp) — Fase 6

  return NextResponse.json({ jobPosting: jobCard(jobPosting) }, { status: 201 });
}
