"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/apiClient";
import type { JobDetail, JobDetailResponse } from "@/lib/apiTypes";
import { formatBRL, formatBRLShort, formatShift, humanizeCategory, initials } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  CalendarIcon,
  ChevronLeftIcon,
  HeartIcon,
  InfoIcon,
  MapPinIcon,
  SendIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@/components/Icons";
import styles from "./JobDetailScreen.module.css";

const TONES: [string, string][] = [
  ["#0066ff", "#4d94ff"],
  ["#0b1f3b", "#2c5387"],
  ["#16a34a", "#4ade80"],
  ["#f97316", "#fdba74"],
  ["#7c3aed", "#a78bfa"],
];

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const [from, to] = TONES[Math.abs(hash) % TONES.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function locationOf(job: JobDetail): string {
  const { city, state } = job.contractor;
  if (city && state) return `${city} - ${state}`;
  if (city) return city;
  if (state) return state;
  return "Local a combinar";
}

/**
 * Detalhe público de uma vaga (GET /api/jobs/:id). Só mostra o que a API
 * expõe — sem inventar requisitos/benefícios que não existem no modelo.
 *
 * "Enviar proposta" é Fase 2: fica desabilitado para não prometer um fluxo
 * que ainda não existe.
 */
export function JobDetailScreen({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    const result = await apiGet<JobDetailResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (result.ok) setJob(result.data.jobPosting);
    else if (result.status === 404) setNotFound(true);
    else setError(result.error);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className={styles.skeleton} />
        <div className={styles.skeletonLine} style={{ width: "70%" }} />
        <div className={styles.skeletonLine} style={{ width: "45%" }} />
        <div className={styles.skeleton} style={{ height: 80 }} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={styles.screen}>
        <Link href="/" className={styles.backRow}>
          <ChevronLeftIcon size={15} /> Voltar para as vagas
        </Link>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Vaga não encontrada</span>
            <span className={styles.emptyText}>
              Ela pode ter sido preenchida, encerrada ou o link está incorreto.
            </span>
            <Link href="/">
              <Button size="sm">Ver outras vagas</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className={styles.screen}>
        <Link href="/" className={styles.backRow}>
          <ChevronLeftIcon size={15} /> Voltar para as vagas
        </Link>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível carregar a vaga</span>
            <span className={styles.emptyText}>{error ?? "Resposta inesperada do servidor"}</span>
            <Button size="sm" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const company = job.contractor.tradeName || job.contractor.name;
  const isOpen = job.status === "ABERTA";

  return (
    <div className={styles.screen}>
      <Link href="/" className={styles.backRow}>
        <ChevronLeftIcon size={15} /> Voltar para as vagas
      </Link>

      <section className={styles.hero} style={{ background: gradientFor(job.category) }}>
        <div className={styles.heroTop}>
          <Badge tone="solid">{isOpen ? "Vaga aberta" : job.status}</Badge>
          <button
            type="button"
            className={styles.heroIconButton}
            disabled
            title="Favoritar — Fase 2"
            aria-label="Favoritar (Fase 2)"
          >
            <HeartIcon size={17} />
          </button>
        </div>
        <div>
          <span className={styles.heroLabel}>{humanizeCategory(job.category)}</span>
          <h1 className={styles.heroTitle}>{job.title}</h1>
        </div>
      </section>

      <div className={styles.metaRow}>
        <span className={styles.valuePill}>
          {formatBRLShort(job.valueCents)}
          <small>/dia</small>
        </span>
        <span className={styles.metaItem}>
          <CalendarIcon size={13} /> {formatShift(job.startsAt, job.endsAt)}
        </span>
        <span className={styles.metaItem}>
          <MapPinIcon size={13} /> {locationOf(job)}
        </span>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{job.applicationsCount}</span>
          <span className={styles.metricLabel}>candidatura(s)</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>
            {job.contractor.verified ? "Sim" : "—"}
          </span>
          <span className={styles.metricLabel}>empresa verificada</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{job.visibility === "PUBLICA" ? "Pública" : "Privada"}</span>
          <span className={styles.metricLabel}>visibilidade</span>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Sobre a vaga</h2>
          {job.urgentBoost && <Badge tone="tag">Destaque</Badge>}
        </div>
        <Card>
          <div className={styles.body}>{job.description?.trim() || "Sem descrição detalhada."}</div>
        </Card>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Pagamento</h2>
        </div>
        <Card>
          <div className={styles.payRow}>
            <div>
              <div className={styles.payValue}>{formatBRL(job.valueCents)}</div>
              <div className={styles.payHint}>por dia de serviço</div>
            </div>
            <InfoIcon size={17} />
          </div>
          <div className={styles.payHint} style={{ marginTop: 8 }}>
            O pagamento é feito pela plataforma e fica retido até a conclusão do serviço.
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Sobre a empresa</h2>
        </div>
        <Card>
          <div className={styles.companyRow}>
            <span className={styles.companyLogo}>{initials(company)}</span>
            <span className={styles.companyBody}>
              <span className={styles.companyName}>{company}</span>
              <span className={styles.companyMeta}>
                {job.contractor.verified ? (
                  <>
                    <ShieldCheckIcon size={11} /> Empresa verificada
                  </>
                ) : (
                  <>
                    <UserIcon size={11} /> Empresa na Freelaz
                  </>
                )}
              </span>
              <span className={styles.companyMeta}>{locationOf(job)}</span>
            </span>
          </div>
        </Card>
      </section>

      <section className={styles.cta}>
        <Button block disabled title="Candidatura — Fase 2">
          <SendIcon size={16} /> Enviar proposta
        </Button>
        <span className={styles.ctaNote}>
          Candidatura e negociação chegam na Fase 2.
        </span>
      </section>
    </div>
  );
}
