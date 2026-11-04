import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Projeção PÚBLICA de profissionais (Fase 2.5).
 *
 * Esta é a única porta de leitura usada por `/api/professionals` e pelo perfil
 * público `/profissional/[id]`. O `select` é fechado de propósito: nada de
 * documento, e-mail, telefone, Pix, arquivos de verificação ou ids internos de
 * Asaas/sessão passam por aqui. Se um campo novo entrar no `User`, ele NÃO
 * aparece automaticamente — precisa ser adicionado conscientemente.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const BIO_PREVIEW_LENGTH = 200;

export type PublicProfessionalSummary = {
  id: string;
  name: string;
  headline: string | null;
  bio: string | null;
  categories: string[];
  city: string | null;
  state: string | null;
  referencePriceCents: number | null;
  ratingAverage: number | null;
  evaluationCount: number;
  verificationStatus: string;
};

export type PublicProfessional = {
  id: string;
  name: string;
  headline: string | null;
  bio: string | null;
  categories: string[];
  availability: string[];
  softSkills: string[];
  region: string | null;
  city: string | null;
  state: string | null;
  referencePriceCents: number | null;
  ratingAverage: number | null;
  evaluationCount: number;
  portfolio: Array<{ id: string; kind: "FOTO" | "VIDEO"; url: string; position: number }>;
  workExperience: Array<{
    id: string;
    company: string;
    role: string;
    periodStart: string;
    periodEnd: string | null;
  }>;
  isInfluencer: boolean;
  verificationStatus: string;
  createdAt: Date;
  avatarUrl?: string | null;
};

export type PublicProfessionalsQuery = {
  q?: string | null;
  category?: string | null;
  city?: string | null;
  state?: string | null;
  minRating?: string | null;
  page?: string | null;
  limit?: string | null;
};

export type PublicProfessionalsResult = {
  professionals: PublicProfessionalSummary[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

/** Trunca a bio do card sem cortar no meio de uma palavra. */
function bioPreview(bio: string | null): string | null {
  const clean = bio?.trim() ?? "";
  if (!clean) return null;
  if (clean.length <= BIO_PREVIEW_LENGTH) return clean;
  const cut = clean.slice(0, BIO_PREVIEW_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > BIO_PREVIEW_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}…`;
}

function positiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Lista pública de profissionais com perfil minimamente preenchido.
 *
 * O filtro de "perfil preenchido" é aplicado em JS (bio/headline com trim ou
 * categorias não vazias) porque `String?` no Postgres aceita `""` e `null`
 * indistintamente para o Prisma; a checagem em memória evita perfis vazios.
 * A ordenação também é feita em JS: `evaluationCount` não é coluna (é derivado
 * das avaliações liberadas), então ordenar por ele no banco exigiria SQL cru.
 */
export async function listPublicProfessionals(
  query: PublicProfessionalsQuery
): Promise<PublicProfessionalsResult> {
  const q = (query.q ?? "").trim();
  const category = (query.category ?? "").trim().toLowerCase();
  const city = (query.city ?? "").trim();
  const state = (query.state ?? "").trim().toUpperCase();
  const minRatingRaw = Number(query.minRating ?? 0);
  const minRating = Number.isFinite(minRatingRaw)
    ? Math.max(0, Math.min(5, minRatingRaw))
    : 0;
  const page = positiveInt(query.page, 1);
  const limit = Math.min(MAX_LIMIT, positiveInt(query.limit, DEFAULT_LIMIT));

  const where: Prisma.UserWhereInput = {
    roles: { some: { role: "PROFISSIONAL", status: "ATIVO" } },
    // Sem categoria, basta existir perfil; com categoria, o filtro é no array.
    ...(category
      ? { professionalProfile: { is: { categories: { has: category } } } }
      : { professionalProfile: { isNot: null } }),
    ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
    ...(state ? { state: { equals: state, mode: "insensitive" } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            {
              professionalProfile: {
                is: { headline: { contains: q, mode: "insensitive" } },
              },
            },
            {
              professionalProfile: {
                is: { bio: { contains: q, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
  };

  const candidates = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      professionalProfile: {
        select: {
          headline: true,
          bio: true,
          categories: true,
          referencePriceCents: true,
          ratingAverage: true,
          verificationStatus: true,
        },
      },
    },
  });

  const withProfile = candidates.filter((candidate) => {
    const profile = candidate.professionalProfile;
    if (!profile) return false;
    return Boolean(
      profile.bio?.trim() ||
        profile.headline?.trim() ||
        profile.categories.length > 0
    );
  });

  const ids = withProfile.map((candidate) => candidate.id);
  const ratingGroups = ids.length
    ? await prisma.evaluation.groupBy({
        by: ["targetId"],
        where: { targetId: { in: ids }, releasedAt: { not: null } },
        _avg: { rating: true },
        _count: { _all: true },
      })
    : [];
  const ratingByTarget = new Map(
    ratingGroups.map((group) => [group.targetId, group])
  );

  const mapped = withProfile.map((candidate) => {
    const profile = candidate.professionalProfile!;
    const rating = ratingByTarget.get(candidate.id);
    const ratingAverage = rating?._avg.rating ?? profile.ratingAverage ?? null;
    const evaluationCount = rating?._count._all ?? 0;
    return {
      id: candidate.id,
      name: candidate.name,
      headline: profile.headline?.trim() || null,
      bio: bioPreview(profile.bio),
      categories: profile.categories,
      city: candidate.city,
      state: candidate.state,
      referencePriceCents: profile.referencePriceCents,
      ratingAverage,
      evaluationCount,
      verificationStatus: profile.verificationStatus,
    } satisfies PublicProfessionalSummary;
  });

  const filtered =
    minRating > 0
      ? mapped.filter(
          (professional) =>
            professional.ratingAverage != null &&
            professional.ratingAverage >= minRating
        )
      : mapped;

  filtered.sort((a, b) => {
    const ratingDiff = (b.ratingAverage ?? -1) - (a.ratingAverage ?? -1);
    if (ratingDiff !== 0) return ratingDiff;
    const countDiff = b.evaluationCount - a.evaluationCount;
    if (countDiff !== 0) return countDiff;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const total = filtered.length;
  const start = (page - 1) * limit;
  const professionals = filtered.slice(start, start + limit);

  return {
    professionals,
    total,
    page,
    limit,
    hasMore: start + professionals.length < total,
  };
}

/**
 * Perfil público de um profissional.
 *
 * 404 (retorno `null`) quando o id não existe ou quando o usuário não tem o
 * papel PROFISSIONAL ATIVO. Um perfil vazio continua acessível pelo id direto;
 * a listagem é que exige preenchimento mínimo.
 */
export async function getPublicProfessional(
  id: string
): Promise<PublicProfessional | null> {
  const user = await prisma.user.findFirst({
    where: {
      id,
      roles: { some: { role: "PROFISSIONAL", status: "ATIVO" } },
    },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      createdAt: true,
      avatarUrl: true,
      professionalProfile: {
        select: {
          headline: true,
          bio: true,
          categories: true,
          availability: true,
          softSkills: true,
          region: true,
          referencePriceCents: true,
          ratingAverage: true,
          isInfluencer: true,
          verificationStatus: true,
        },
      },
      portfolioItems: {
        select: { id: true, kind: true, url: true, position: true },
        orderBy: { position: "asc" },
      },
      workExperiences: {
        select: {
          id: true,
          company: true,
          role: true,
          periodStart: true,
          periodEnd: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user?.professionalProfile) return null;
  const profile = user.professionalProfile;

  const rating = await prisma.evaluation.aggregate({
    where: { targetId: user.id, releasedAt: { not: null } },
    _avg: { rating: true },
    _count: { _all: true },
  });

  return {
    id: user.id,
    name: user.name,
    headline: profile.headline?.trim() || null,
    bio: profile.bio?.trim() || null,
    categories: profile.categories,
    availability: profile.availability,
    softSkills: profile.softSkills,
    region: profile.region,
    city: user.city,
    state: user.state,
    referencePriceCents: profile.referencePriceCents,
    ratingAverage: rating._avg.rating ?? profile.ratingAverage ?? null,
    evaluationCount: rating._count._all ?? 0,
    portfolio: user.portfolioItems,
    workExperience: user.workExperiences,
    isInfluencer: profile.isInfluencer,
    verificationStatus: profile.verificationStatus,
    createdAt: user.createdAt,
    avatarUrl: user.avatarUrl ?? null,
  };
}
