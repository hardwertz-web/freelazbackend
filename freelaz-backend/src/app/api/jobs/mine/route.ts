import { NextRequest, NextResponse } from "next/server";
import type { JobPostingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, hasActiveRole } from "@/lib/auth";

/** Status aceitos no filtro da tela. `EXPIRADA` cai na aba "Todas". */
const FILTERABLE: JobPostingStatus[] = ["ABERTA", "PREENCHIDA", "CANCELADA", "EXPIRADA"];

/**
 * GET /api/jobs/mine?status=ABERTA|PREENCHIDA|EXPIRADA|CANCELADA
 *
 * Backlog #3 — lista as vagas publicadas pelo contratante logado. Sem filtro
 * devolve todas (é o que a tela usa: um fetch só e as tabs filtram em memória,
 * junto com as contagens por status).
 *
 * Diferente de `GET /api/jobs` (marketplace público), aqui o contratante vê as
 * próprias vagas em qualquer status/visibilidade, incluindo CANCELADA e
 * PRIVADA ("Me contrate").
 *
 * As candidaturas vêm com `status` para a tela montar as contagens por bucket;
 * `hirings` traz só a contratação mais recente (usada pelos botões "Ver
 * contratação"/"Ver chat" da vaga PREENCHIDA).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  if (!hasActiveRole(auth.user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = (searchParams.get("status") ?? "").trim().toUpperCase();
  const statusFilter = FILTERABLE.includes(statusParam as JobPostingStatus)
    ? (statusParam as JobPostingStatus)
    : undefined;

  const [jobs, counts] = await Promise.all([
    prisma.jobPosting.findMany({
      where: {
        contractorId: auth.user.id,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      // `select` explícito: a tela não precisa de description/tags/requirements
      // e o dono não deve receber payload maior do que o card consome.
      select: {
        id: true,
        title: true,
        status: true,
        valueCents: true,
        startsAt: true,
        endsAt: true,
        city: true,
        state: true,
        createdAt: true,
        urgentBoost: true,
        visibility: true,
        applications: { select: { status: true } },
        hirings: {
          select: { id: true, status: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.jobPosting.groupBy({
      by: ["status"],
      where: { contractorId: auth.user.id },
      _count: { _all: true },
    }),
  ]);

  const enriched = jobs.map((job) => {
    const apps = job.applications;
    const pending = apps.filter((a) => a.status === "PENDENTE").length;
    const counter = apps.filter((a) => a.status === "CONTRAPROPOSTA").length;
    const selected = apps.filter((a) => a.status === "SELECIONADO").length;
    const suplente = apps.filter((a) => a.status === "SUPLENTE").length;
    const desistiu = apps.filter((a) => a.status === "DESISTIU").length;
    // "Ativa" = candidatura viva (decisão 5: CONTRAPROPOSTA entra, DESISTIU não).
    const active = pending + counter + selected + suplente;
    const latestHiring = job.hirings[0] ?? null;
    const { applications, hirings, ...jobData } = job;
    return {
      ...jobData,
      applicationsCount: { total: apps.length, pending, counter, selected, suplente, desistiu, active },
      latestHiringId: latestHiring?.id ?? null,
      latestHiringStatus: latestHiring?.status ?? null,
    };
  });

  // Contagens das tabs: sempre sobre TODAS as vagas do contratante, nunca
  // sobre o filtro atual — senão os números das outras abas zeravam.
  const countsByStatus: Record<string, number> = {};
  let totalAll = 0;
  for (const row of counts) {
    countsByStatus[row.status] = row._count._all;
    totalAll += row._count._all;
  }
  countsByStatus.ALL = totalAll;

  return NextResponse.json({ jobs: enriched, countsByStatus, total: jobs.length });
}
