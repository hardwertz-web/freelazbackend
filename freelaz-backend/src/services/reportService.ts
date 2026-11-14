import { prisma } from "../lib/prisma";
import { ReportCategory } from "@prisma/client";
import { notifyAndDispatch } from "./notificationService";

/**
 * Denúncia de comportamento — fila SEPARADA das disputas e PRIORITÁRIA para
 * abuso (task_plan Fase 4). Denúncia NUNCA move dinheiro: se dinheiro for o
 * caso, ele sai de uma decisão de disputa auditada (disputeService). Aqui é
 * só registro, priorização e trâmite administrativo.
 *
 * Prioridade: categoria ABUSO nasce com priority "ALTA" (fila prioritária);
 * as demais, "NORMAL". A listagem admin devolve ALTA primeiro e, dentro da
 * mesma prioridade, por ordem de chegada — atendimento justo e previsível.
 */

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_NOTE_LENGTH = 1000;

/**
 * Rótulos humanos por categoria. O corpo da notificação/e-mail não deve
 * expor o token do enum ("NAO_COMPARECEU"), e a UI ainda não tem um mapa.
 */
const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  ABUSO: "Abuso",
  FRAUDE: "Fraude",
  NAO_COMPARECEU: "Não compareceu",
  OUTRO: "Outro",
};

/**
 * Registra uma denúncia. Anti-spam: no máximo 5 denúncias por denunciante em
 * 24h, e o mesmo alvo+contexto não pode repetir dentro de 7 dias.
 */
export async function createReport(params: {
  reporterId: string;
  reportedId: string;
  hiringId?: string | null;
  category: string;
  description: string;
}) {
  if (params.reporterId === params.reportedId) {
    throw new Error("Você não pode denunciar a si mesmo");
  }
  const category = params.category as ReportCategory;
  if (!Object.values(ReportCategory).includes(category)) {
    throw new Error(
      `category deve ser uma de: ${Object.values(ReportCategory).join(", ")}`
    );
  }
  const description = params.description?.trim();
  if (!description) throw new Error("description é obrigatória");
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`description muito longa (máximo ${MAX_DESCRIPTION_LENGTH} caracteres)`);
  }

  const reported = await prisma.user.findUnique({ where: { id: params.reportedId } });
  if (!reported) throw new Error("Usuário denunciado não encontrado");

  // Guarda o jobTitle da validação para reaproveitar na notificação — uma única
  // query de hiring por denúncia (o jobTitle não muda entre os dois pontos).
  let hiringForNotification: { jobTitle: string } | null = null;

  if (params.hiringId) {
    const hiring = await prisma.hiring.findUnique({
      where: { id: params.hiringId },
      select: { contractorId: true, professionalId: true, jobTitle: true },
    });
    if (!hiring) throw new Error("Contratação não encontrada");
    const involvesReported =
      hiring.contractorId === params.reportedId || hiring.professionalId === params.reportedId;
    const involvesReporter =
      hiring.contractorId === params.reporterId || hiring.professionalId === params.reporterId;
    if (!involvesReported || !involvesReporter) {
      throw new Error("A contratação precisa envolver quem denuncia e quem é denunciado");
    }
    hiringForNotification = hiring;
  }

  // Anti-spam: máximo 5 denúncias por reporter em 24h.
  // (Fila admin vira ruído se um único usuário floodar.)
  const DAY_MS = 24 * 60 * 60 * 1000;
  const recentCount = await prisma.report.count({
    where: {
      reporterId: params.reporterId,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
  });
  if (recentCount >= 5) {
    throw new Error("Limite de 5 denúncias por 24h atingido. Aguarde ou contate o suporte.");
  }

  // Anti-duplicidade: mesmo alvo + mesmo contexto nos últimos 7 dias.
  const DUPLICATE_WINDOW_MS = 7 * DAY_MS;
  const duplicate = await prisma.report.findFirst({
    where: {
      reporterId: params.reporterId,
      reportedId: params.reportedId,
      hiringId: params.hiringId ?? null,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new Error(
      "Você já denunciou este usuário por este contexto nos últimos 7 dias."
    );
  }

  const report = await prisma.report.create({
    data: {
      reporterId: params.reporterId,
      reportedId: params.reportedId,
      hiringId: params.hiringId ?? null,
      category,
      priority: category === "ABUSO" ? "ALTA" : "NORMAL",
      description,
    },
  });

  // Backlog pós-4b: notifica o denunciado SEMPRE, exceto ABUSO (para não
  // expor o denunciante a retaliação). Em ABUSO, só o admin vê a fila.
  // notifyAndDispatch garante e-mail (a UI in-app do sino ainda não existe).
  if (category !== "ABUSO") {
    try {
      // Contexto: o título da contratação já veio da validação acima.
      const hiringTitle = hiringForNotification?.jobTitle ?? null;

      const categoryLabel = REPORT_CATEGORY_LABELS[category];
      await notifyAndDispatch({
        userId: params.reportedId,
        type: "REPORT_RECEIVED",
        title: "Você recebeu uma denúncia no Freelaz",
        body: `Categoria: ${categoryLabel}. ${
          hiringTitle ? `Referente à contratação "${hiringTitle}". ` : ""
        }Um administrador vai analisar em breve. Para se defender, contate freelaz.conecta@gmail.com.`,
        payload: {
          reportId: report.id,
          category,
          categoryLabel,
          hiringId: params.hiringId ?? null,
          hiringTitle,
        },
        dedupeKey: `report:${report.id}:received`,
      });
    } catch (err) {
      // Notificação é observabilidade: falha não deve reverter a denúncia.
      console.warn(
        `[reportService] falha ao notificar denunciado (report ${report.id}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return report;
}

/** Fila administrativa: ALTA primeiro; empate por ordem de chegada. */
export async function listReports(status?: string) {
  const where = status ? { status: status as never } : {};
  const include = {
    reporter: { select: { id: true, name: true } },
    reported: { select: { id: true, name: true } },
    // Contexto opcional da denúncia para a análise no painel (Fase 5).
    hiring: { select: { id: true, jobTitle: true, status: true } },
  };
  const [alta, normal] = await Promise.all([
    prisma.report.findMany({
      where: { ...where, priority: "ALTA" },
      orderBy: { createdAt: "asc" },
      include,
    }),
    prisma.report.findMany({
      where: { ...where, priority: "NORMAL" },
      orderBy: { createdAt: "asc" },
      include,
    }),
  ]);
  return [...alta, ...normal];
}

export async function resolveReport(params: {
  reportId: string;
  decidedById: string;
  outcome: "ACAO_TOMADA" | "ARQUIVADA";
  decisionNote: string;
}) {
  const decisionNote = params.decisionNote?.trim();
  if (!decisionNote) throw new Error("decisionNote é obrigatória (auditoria da decisão)");
  if (decisionNote.length > MAX_NOTE_LENGTH) {
    throw new Error(`decisionNote muito longa (máximo ${MAX_NOTE_LENGTH} caracteres)`);
  }
  if (params.outcome !== "ACAO_TOMADA" && params.outcome !== "ARQUIVADA") {
    throw new Error("outcome deve ser ACAO_TOMADA ou ARQUIVADA");
  }

  const report = await prisma.report.findUnique({ where: { id: params.reportId } });
  if (!report) throw new Error("Denúncia não encontrada");
  if (report.status === "ACAO_TOMADA" || report.status === "ARQUIVADA") {
    throw new Error("Esta denúncia já foi encerrada");
  }

  return prisma.report.update({
    where: { id: report.id },
    data: {
      status: params.outcome,
      decidedById: params.decidedById,
      decisionNote,
      resolvedAt: new Date(),
    },
  });
}
