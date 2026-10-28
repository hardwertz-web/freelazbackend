import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, hasActiveRole } from "@/lib/auth";
import { getPublicProfessional } from "@/lib/publicProfessional";
import type { PublicProfessionalProfile } from "@/lib/apiTypes";
import { ProfileScreen } from "@/components/screens/ProfileScreen";

type Params = { params: { id: string } };

/**
 * Perfil público do profissional (Fase 2.5).
 *
 * 404 REAL (via `notFound()`) quando o id não existe ou o usuário não tem o
 * papel PROFISSIONAL ATIVO. O perfil é `noindex`: é conteúdo de marketplace,
 * não uma página para o Google indexar.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const professional = await getPublicProfessional(params.id);
  return {
    title: professional ? `${professional.name} — Freelaz` : "Profissional não encontrado — Freelaz",
    description: professional?.headline ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function ProfissionalPage({ params }: Params) {
  const professional = await getPublicProfessional(params.id);
  if (!professional) notFound();

  const viewer = await getCurrentUser();

  const publicProfile: PublicProfessionalProfile = {
    id: professional.id,
    name: professional.name,
    headline: professional.headline,
    bio: professional.bio,
    categories: professional.categories,
    availability: professional.availability,
    softSkills: professional.softSkills,
    region: professional.region,
    city: professional.city,
    state: professional.state,
    referencePriceCents: professional.referencePriceCents,
    ratingAverage: professional.ratingAverage,
    evaluationCount: professional.evaluationCount,
    portfolio: professional.portfolio,
    workExperience: professional.workExperience,
    isInfluencer: professional.isInfluencer,
    verificationStatus: professional.verificationStatus,
    createdAt: professional.createdAt.toISOString(),
  };

  return (
    <ProfileScreen
      mode="public"
      professional={publicProfile}
      viewer={{
        loggedIn: Boolean(viewer),
        canHire: Boolean(viewer && hasActiveRole(viewer, "CONTRATANTE")),
        isSelf: viewer?.id === professional.id,
      }}
    />
  );
}
