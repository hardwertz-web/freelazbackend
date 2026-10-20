import type { Application, JobPosting, User, UserRoleAssignment } from "@prisma/client";
import { prisma } from "./prisma";
import { requireUser, hasActiveRole } from "./auth";

type AppWithJob = Application & { jobPosting: JobPosting };
type SessionUser = User & { roles: UserRoleAssignment[] };

/**
 * Quem pode agir numa candidatura: o profissional que se candidatou ou o
 * contratante dono da vaga. Qualquer outro usuário recebe 403 — as rotas
 * de negociação (contraproposta, aceite/recusa) usam isso em conjunto.
 */
export function sideOf(
  application: { professionalId: string; jobPosting: { contractorId: string } },
  userId: string
): "CONTRACTOR" | "PROFESSIONAL" | null {
  if (application.professionalId === userId) return "PROFESSIONAL";
  if (application.jobPosting.contractorId === userId) return "CONTRACTOR";
  return null;
}

type Side = "CONTRACTOR" | "PROFESSIONAL";

/** Sessão válida + candidatura + participação + papel ativo do lado que age. */
export async function requireApplicationParty(
  applicationId: string,
  expectedSide?: Side
): Promise<
  | { user: SessionUser; application: AppWithJob; side: Side; error?: undefined }
  | { error: { status: number; body: { error: string } } }
> {
  const auth = await requireUser();
  if (auth.error) return { error: auth.error };

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { jobPosting: true },
  });
  if (!application) {
    return { error: { status: 404, body: { error: "Candidatura não encontrada" } } };
  }

  const side = sideOf(application, auth.user.id);
  if (!side) {
    return { error: { status: 403, body: { error: "Você não participa desta candidatura" } } };
  }
  if (expectedSide && side !== expectedSide) {
    return {
      error: {
        status: 403,
        body: { error: `Esta ação é do lado ${expectedSide} da negociação` },
      },
    };
  }
  if (!hasActiveRole(auth.user, side === "CONTRACTOR" ? "CONTRATANTE" : "PROFISSIONAL")) {
    return {
      error: {
        status: 403,
        body: {
          error: `Seu papel ${side === "CONTRACTOR" ? "Contratante" : "Profissional"} não está ativo`,
        },
      },
    };
  }

  return { user: auth.user, application, side };
}
