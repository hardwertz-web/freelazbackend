"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type {
  MeResponse,
  ProfileResponse,
  PublicProfessionalProfile,
  Role,
} from "@/lib/apiTypes";
import { formatBRLShort, humanizeCategory, humanizeCode, initials } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { HireMeModal } from "@/components/HireMeModal";
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
function SelfProfileScreen() {
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
            {(profile as any)?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={(profile as any).avatarUrl} alt={displayName} className={styles.avatarImg} />
            ) : (
              <span className={styles.avatar}>{initials(displayName)}</span>
            )}
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
          onClick={() => router.push("/perfil/editar")}
        >
          <ChevronLeftIcon size={14} /> Editar perfil
        </Button>
        <Button variant="danger" onClick={() => void handleLogout()} disabled={loggingOut}>
          <LogoutIcon size={14} /> {loggingOut ? "Saindo..." : "Sair"}
        </Button>
      </div>
    </div>
  );
}

// ----- Perfil público (Fase 2.5) -----

type PublicViewer = {
  loggedIn: boolean;
  canHire: boolean;
  isSelf: boolean;
};

type ProfileScreenProps =
  | { mode?: "self" }
  | {
      mode: "public";
      professional: PublicProfessionalProfile;
      viewer: PublicViewer;
    };

/**
 * `mode="public"` reusa a mesma casca visual do perfil próprio, mas com a
 * projeção pública de `GET /api/professionals/:id`: sem Editar/Sair, sem
 * Conta/PII, sem força do perfil e com o CTA de contratação.
 */
export function ProfileScreen(props: ProfileScreenProps) {
  if (props.mode === "public") {
    return (
      <PublicProfileScreen
        professional={props.professional}
        viewer={props.viewer}
      />
    );
  }
  return <SelfProfileScreen />;
}

function PublicProfileScreen({
  professional,
  viewer,
}: {
  professional: PublicProfessionalProfile;
  viewer: PublicViewer;
}) {
  const router = useRouter();
  const [hireOpen, setHireOpen] = useState(false);
  const [ratingsSummary, setRatingsSummary] = useState<{ total: number; average: number; distribution: Record<number, number> } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/professionals/${professional.id}/ratings-summary`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setRatingsSummary(data);
        }
      } catch {
        // ignore
      }
    })();
  }, [professional.id]);

  const displayName = professional.name;
  const verified = professional.verificationStatus === "VERIFICADO";
  const hasRating =
    professional.ratingAverage != null && professional.evaluationCount > 0;
  const location = [professional.city, professional.state].filter(Boolean).join(" - ");
  const loginHref = `/login?redirect=${encodeURIComponent(`/profissional/${professional.id}`)}`;

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Perfil profissional</h1>
        <p className={styles.subtitle}>Categorias, experiência e avaliações de {displayName}.</p>
      </div>

      <section className={styles.hero}>
        <div className={styles.identity}>
          <span className={styles.avatarWrap}>
            {(professional as any)?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={(professional as any).avatarUrl} alt={displayName} className={styles.avatarImg} />
            ) : (
              <span className={styles.avatar}>{initials(displayName)}</span>
            )}
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
            <span className={styles.headline}>
              {professional.headline ??
                (professional.categories.length > 0
                  ? professional.categories.map(humanizeCategory).join(" · ")
                  : "Profissional Freelaz")}
            </span>
            {(professional.region || location) && (
              <span className={styles.region}>
                <MapPinIcon size={12} /> {professional.region ?? location}
              </span>
            )}
          </span>
        </div>

        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricIcon}>
              <StarIcon size={14} filled={hasRating} />
            </span>
            <span className={styles.metricBody}>
              <span className={styles.metricValue}>
                {hasRating ? professional.ratingAverage!.toFixed(1) : "—"}
              </span>
              <span className={styles.metricLabel}>
                {professional.evaluationCount > 0
                  ? `${professional.evaluationCount} ${
                      professional.evaluationCount === 1 ? "avaliação" : "avaliações"
                    }`
                  : "Novo no Freelaz"}
              </span>
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricIcon}>
              <BriefcaseIcon size={14} />
            </span>
            <span className={styles.metricBody}>
              <span className={styles.metricValue}>
                {professional.referencePriceCents != null
                  ? formatBRLShort(professional.referencePriceCents)
                  : "—"}
              </span>
              <span className={styles.metricLabel}>Preço de referência</span>
            </span>
          </div>
        </div>
      </section>

      {professional.categories.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Categorias</h2>
          </div>
          <div className={styles.chipRow}>
            {professional.categories.map((category, index) => (
              <Chip key={category} active={index === 0}>
                {humanizeCategory(category)}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {professional.bio && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Sobre</h2>
            {professional.referencePriceCents != null && (
              <span className={styles.sectionHint}>
                Referência: {formatBRLShort(professional.referencePriceCents)}
              </span>
            )}
          </div>
          <Card>
            <p className={styles.bio}>{professional.bio}</p>
          </Card>
        </section>
      )}

      {professional.workExperience.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Experiência profissional</h2>
            <span className={styles.sectionHint}>
              {professional.workExperience.length} registro(s)
            </span>
          </div>
          <div className={styles.list}>
            {professional.workExperience.map((experience) => (
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

      {(professional.evaluationCount > 0 || (ratingsSummary && ratingsSummary.total > 0)) && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Avaliações</h2>
            <span className={styles.sectionHint}>
              {ratingsSummary?.average?.toFixed(1) ?? professional.ratingAverage?.toFixed(1)} ★ · {ratingsSummary?.total ?? professional.evaluationCount} avaliação(ões)
            </span>
          </div>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[5, 4, 3, 2, 1].map((star) => {
                const dist = ratingsSummary?.distribution || {};
                const count = dist[star] || 0;
                const total = ratingsSummary?.total || professional.evaluationCount || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={star} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 32, fontSize: 12 }}>{star} ★</span>
                    <div style={{ flex: 1, height: 8, background: "#E5E7EB", borderRadius: 9999, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#F59E0B" }} />
                    </div>
                    <span style={{ width: 36, fontSize: 12, textAlign: "right" }}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      {(professional.availability.length > 0 || professional.softSkills.length > 0) && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Disponibilidade e habilidades</h2>
          </div>
          <div className={styles.tags}>
            {professional.availability.map((code) => (
              <span key={code} className={styles.tag}>
                {humanizeCode(code)}
              </span>
            ))}
            {professional.softSkills.map((skill) => (
              <span key={skill} className={styles.tag}>
                {skill}
              </span>
            ))}
          </div>
        </section>
      )}

      {professional.portfolio.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Portfólio</h2>
            <span className={styles.sectionHint}>{professional.portfolio.length} item(ns)</span>
          </div>
          {viewer.loggedIn ? (
            <div className={styles.portfolio}>
              {professional.portfolio.map((item) => (
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
          ) : (
            <Card>
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>Entre para ver o portfólio</span>
                <span className={styles.emptyText}>
                  As imagens do portfólio são liberadas para usuários logados.
                </span>
                <Button size="sm" onClick={() => router.push(loginHref)}>
                  Entrar
                </Button>
              </div>
            </Card>
          )}
        </section>
      )}

      {viewer.isSelf ? (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Este é o seu perfil público</span>
            <span className={styles.emptyText}>É assim que os contratantes veem você.</span>
          </div>
        </Card>
      ) : viewer.canHire ? (
        <div className={styles.actionsRow}>
          <Button block onClick={() => setHireOpen(true)}>
            Me contrate
          </Button>
        </div>
      ) : viewer.loggedIn ? (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Contrate este profissional</span>
            <span className={styles.emptyText}>
              Ative o papel Contratante na sua conta para enviar propostas.
            </span>
            <Button size="sm" variant="secondary" onClick={() => router.push("/perfil")}>
              Ativar papel Contratante
            </Button>
          </div>
        </Card>
      ) : (
        <div className={styles.actionsRow}>
          <Button block onClick={() => router.push(loginHref)}>
            Entrar para contratar
          </Button>
        </div>
      )}

      {hireOpen && (
        <HireMeModal
          professionalId={professional.id}
          professionalName={displayName}
          categories={professional.categories}
          onClose={() => setHireOpen(false)}
        />
      )}
    </div>
  );
}
