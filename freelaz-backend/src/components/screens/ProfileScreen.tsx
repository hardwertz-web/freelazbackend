"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type { MeResponse, ProfileResponse, Role } from "@/lib/apiTypes";
import { formatBRLShort, humanizeCategory, humanizeCode, initials } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import {
  BriefcaseIcon,
  CheckIcon,
  ChevronLeftIcon,
  LogoutIcon,
  MapPinIcon,
  ShieldCheckIcon,
  StarIcon,
} from "@/components/Icons";
import styles from "./ProfileScreen.module.css";

const ROLE_LABEL: Record<string, string> = {
  PROFISSIONAL: "Profissional",
  CONTRATANTE: "Contratante",
  ADMIN: "Admin",
};

const ROLE_STATUS: Record<string, string> = {
  ATIVO: "Ativo",
  PENDENTE: "Pendente",
};

function roleBadgeTone(status: string): "success" | "tag" | "neutral" {
  if (status === "ATIVO") return "success";
  if (status === "PENDENTE") return "tag";
  return "neutral";
}

/**
 * Perfil do profissional logado. Combina a identidade (GET /api/auth/me) com
 * o perfil do papel (GET /api/profile/professional).
 *
 * Se o papel Profissional estiver PENDENTE, a rota devolve 409 — nesse caso
 * mostramos a conta e explicamos o que falta, em vez de inventar dados.
 */
export function ProfileScreen() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [profileBlocked, setProfileBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProfileBlocked(null);

    const [meResult, profileResult] = await Promise.all([
      apiGet<MeResponse>("/api/auth/me"),
      apiGet<ProfileResponse>("/api/profile/professional"),
    ]);

    if (!meResult.ok) {
      if (meResult.status === 401) {
        router.replace("/login");
        return;
      }
      setError(meResult.error);
      setLoading(false);
      return;
    }

    setMe(meResult.data);
    if (profileResult.ok) {
      setProfileData(profileResult.data);
    } else if (profileResult.status === 409) {
      setProfileBlocked(profileResult.error);
    } else if (profileResult.status !== 401) {
      setProfileBlocked(profileResult.error);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    setLoggingOut(true);
    await apiPost("/api/auth/logout", {});
    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Perfil</h1>
          <p className={styles.subtitle}>Seus dados e como você aparece na plataforma.</p>
        </div>
        <div className={styles.skeleton} />
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <h1 className={styles.title}>Perfil</h1>
        </div>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível carregar o perfil</span>
            <span className={styles.emptyText}>{error ?? "Sessão inválida"}</span>
            <Button size="sm" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const { user, roles } = me;
  const profile = profileData?.profile ?? null;
  const strength = profileData?.profileStrength ?? 0;
  const displayName = user.tradeName || user.name;
  const verified = profile?.verificationStatus === "VERIFICADO";
  const hasRating = profile?.ratingAverage != null && profile.ratingAverage > 0;
  const evaluationCount = profile?.evaluationCount ?? 0;

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Perfil</h1>
        <p className={styles.subtitle}>Seus dados e como você aparece na plataforma.</p>
      </div>

      <section className={styles.hero}>
        <div className={styles.identity}>
          <span className={styles.avatarWrap}>
            <span className={styles.avatar}>{initials(displayName)}</span>
            {verified && (
              <span className={styles.avatarCheck} aria-hidden="true">
                <CheckIcon size={12} />
              </span>
            )}
          </span>
          <span className={styles.identityBody}>
            <span className={styles.nameRow}>
              <span className={styles.name}>{displayName}</span>
              {verified && (
                <Badge tone="primary" icon={<ShieldCheckIcon size={11} />}>
                  Verificado
                </Badge>
              )}
            </span>
            {profile?.headline && <span className={styles.headline}>{profile.headline}</span>}
            {!profile?.headline && (
              <span className={styles.headline}>
                {profile ? "Profissional Freelaz" : "Conta Freelaz"}
              </span>
            )}
            {profile?.region && (
              <span className={styles.region}>
                <MapPinIcon size={12} /> {profile.region}
              </span>
            )}
          </span>
        </div>

        {profile && (
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <StarIcon size={14} filled={hasRating} />
              </span>
              <span className={styles.metricBody}>
                <span className={styles.metricValue}>
                  {hasRating ? profile.ratingAverage!.toFixed(1) : "—"}
                </span>
                <span className={styles.metricLabel}>
                  {evaluationCount > 0
                    ? `${evaluationCount} ${evaluationCount === 1 ? "avaliação" : "avaliações"}`
                    : "Avaliações"}
                </span>
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <ShieldCheckIcon size={14} />
              </span>
              <span className={styles.metricBody}>
                <span className={styles.metricValue}>
                  {profile.reliabilityScore != null
                    ? `${profile.reliabilityScore.toFixed(0)}%`
                    : "—"}
                </span>
                <span className={styles.metricLabel}>Confiabilidade</span>
              </span>
            </div>
          </div>
        )}
      </section>

      {!profile && (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>
              {profileBlocked ? "Perfil profissional não ativado" : "Sem perfil profissional"}
            </span>
            <span className={styles.emptyText}>
              {profileBlocked ??
                "Esta conta não tem o papel Profissional. Ative o papel para criar perfil, portfólio e receber por serviços."}
            </span>
            <span className={styles.tag}>
              Papel Profissional:{" "}
              {ROLE_STATUS[roles.find((role) => role.role === "PROFISSIONAL")?.status ?? ""] ?? "não ativo"}
            </span>
          </div>
        </Card>
      )}

      {profile && (
        <>
          {profile.categories.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Categorias</h2>
              </div>
              <div className={styles.chipRow}>
                {profile.categories.map((category, index) => (
                  <Chip key={category} active={index === 0}>
                    {humanizeCategory(category)}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Sobre</h2>
              {profile.referencePriceCents != null && (
                <span className={styles.sectionHint}>
                  Referência: {formatBRLShort(profile.referencePriceCents)}
                </span>
              )}
            </div>
            <Card>
              <p className={styles.bio}>
                {profile.bio?.trim() ? profile.bio : "Você ainda não escreveu uma apresentação."}
              </p>
            </Card>
          </section>

          {profile.workExperiences.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Experiência profissional</h2>
                <span className={styles.sectionHint}>
                  {profile.workExperiences.length} registro(s)
                </span>
              </div>
              <div className={styles.list}>
                {profile.workExperiences.map((experience) => (
                  <div key={experience.id} className={styles.exp}>
                    <span className={styles.expIcon}>
                      <BriefcaseIcon size={15} />
                    </span>
                    <span className={styles.expBody}>
                      <span className={styles.expRole}>{experience.role}</span>
                      <span className={styles.expMeta}>{experience.company}</span>
                      <span className={styles.expMeta}>
                        {experience.periodStart}
                        {experience.periodEnd ? ` — ${experience.periodEnd}` : " — atual"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(profile.availability.length > 0 || profile.softSkills.length > 0) && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Disponibilidade e habilidades</h2>
              </div>
              <div className={styles.tags}>
                {profile.availability.map((code) => (
                  <span key={code} className={styles.tag}>
                    {humanizeCode(code)}
                  </span>
                ))}
                {profile.softSkills.map((skill) => (
                  <span key={skill} className={styles.tag}>
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          )}

          {profile.portfolioItems.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Portfólio</h2>
                <span className={styles.sectionHint}>
                  {profile.portfolioItems.length} item(ns)
                </span>
              </div>
              <div className={styles.portfolio}>
                {profile.portfolioItems.map((item) => (
                  <span key={item.id} className={styles.portfolioItem}>
                    {item.kind === "FOTO" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- uploads servidos pela própria API
                      <img src={item.url} alt="Item do portfólio" loading="lazy" />
                    ) : (
                      <span className={styles.portfolioEmpty}>Vídeo</span>
                    )}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Força do perfil</h2>
              <span className={styles.sectionHint}>{strength}% — visível só para você</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${Math.min(100, strength)}%` }} />
            </div>
            {profile.portfolioItems.length === 0 && (
              <span className={styles.sectionHint}>
                Adicione portfólio e experiências para aumentar a força do perfil.
              </span>
            )}
          </section>
        </>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Conta</h2>
        </div>
        <Card>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>E-mail</span>
            <span className={styles.accountValue}>{user.email}</span>
          </div>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Telefone</span>
            <span className={styles.accountValue}>{user.phone}</span>
          </div>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>{user.documentType}</span>
            <span className={styles.accountValue}>{user.documentMasked}</span>
          </div>
          {(user.city || user.state) && (
            <div className={styles.accountRow}>
              <span className={styles.accountLabel}>Local</span>
              <span className={styles.accountValue}>
                {[user.city, user.state].filter(Boolean).join(" - ")}
              </span>
            </div>
          )}
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Papéis</span>
            <span className={styles.accountValue}>
              {roles.length === 0
                ? "—"
                : roles.map((role: Role) => `${ROLE_LABEL[role.role] ?? role.role}: ${ROLE_STATUS[role.status] ?? role.status}`).join(" · ")}
            </span>
          </div>
        </Card>
      </section>

      <div className={styles.actionsRow}>
        <Button
          variant="secondary"
          disabled
          title="Edição de perfil — Fase 2"
        >
          <ChevronLeftIcon size={14} /> Editar perfil (Fase 2)
        </Button>
        <Button variant="danger" onClick={() => void handleLogout()} disabled={loggingOut}>
          <LogoutIcon size={14} /> {loggingOut ? "Saindo..." : "Sair"}
        </Button>
      </div>
    </div>
  );
}
