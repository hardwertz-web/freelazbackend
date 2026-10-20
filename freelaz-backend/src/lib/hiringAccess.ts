import type {
  Chat,
  Hiring,
  JobPosting,
  LedgerEntry,
  Payout,
  UserRoleAssignment,
  User,
} from "@prisma/client";
import { prisma } from "./prisma";
import { requireUser } from "./auth";

type SessionUser = User & { roles: UserRoleAssignment[] };
type HiringWithChat = Hiring & {
  chat: Chat | null;
  jobPosting: JobPosting;
  ledgerEntries: LedgerEntry[];
  payout: Payout | null;
};

/**
 * Quem pode agir numa contratação: a empresa contratante ou o profissional
 * contratado. Espelha `applicationAccess.ts` — as rotas de pagamento e de
 * chat usam isso para nunca vazar conversa/histórico para terceiros.
 */
export function sideOfHiring(
  hiring: { contractorId: string; professionalId: string },
  userId: string
): "CONTRACTOR" | "PROFESSIONAL" | null {
  if (hiring.contractorId === userId) return "CONTRACTOR";
  if (hiring.professionalId === userId) return "PROFESSIONAL";
  return null;
}

export async function requireHiringParticipant(hiringId: string): Promise<
  | { user: SessionUser; hiring: HiringWithChat; side: "CONTRACTOR" | "PROFESSIONAL"; error?: undefined }
  | { error: { status: number; body: { error: string } } }
> {
  const auth = await requireUser();
  if (auth.error) return { error: auth.error };

  const hiring = await prisma.hiring.findUnique({
    where: { id: hiringId },
    include: { chat: true, jobPosting: true, ledgerEntries: true, payout: true },
  });
  if (!hiring) {
    return { error: { status: 404, body: { error: "Contratação não encontrada" } } };
  }

  const side = sideOfHiring(hiring, auth.user.id);
  if (!side) {
    return { error: { status: 403, body: { error: "Você não participa desta contratação" } } };
  }

  return { user: auth.user, hiring, side };
}
