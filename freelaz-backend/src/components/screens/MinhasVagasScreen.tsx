"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost } from "@/lib/apiClient";
import { formatBRLShort, formatDay } from "@/lib/format";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import {
  BriefcaseIcon,
  CalendarIcon,
  ChevronLeftIcon,
  MapPinIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  UsersIcon,
} from "@/components/Icons";
import styles from "./MinhasVagasScreen.module.css";

type JobStatus = "ABERTA" | "PREENCHIDA" | "EXPIRADA" | "CANCELADA";

type ApplicationsCount = {
  total: number;
  pending: number;
  counter: number;
  selected: number;
  suplente: number;
  desistiu: number;
  /** Candidaturas vivas: PENDENTE + CONTRAPROPOSTA + SELECIONADO + SUPLENTE. */
  active: number;
};

type MyJob = {
  id: string;
  title: string;
  status: JobStatus;
  valueCents: number;
  startsAt: string;
  endsAt: string;
  city: string | null;
  state: string | null;
  createdAt: string;
  urgentBoost: boolean;
  visibility: "PUBLICA" | "PRIVADA";
  applicationsCount: ApplicationsCount;
  latestHiringId: string | null;
  latestHiringStatus: string | null;
};

type MineResponse = {
  jobs: MyJob[];
  countsByStatus: Record<string, number>;
  total: number;
};

const TABS = [
  { id: "ALL", label: "Todas" },
  { id: "ABERTA", label: "Abertas" },
  { id: "PREENCHIDA", label: "Preenchidas" },
  { id: "CANCELADA", label: "Canceladas" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<JobStatus, string> = {
  ABERTA: "Vaga aberta",
  PREENCHIDA: "Preenchida",
  CANCELADA: "Cancelada",
  EXPIRADA: "Expirada",
};

const STATUS_CLASS: Record<JobStatus, string> = {
  ABERTA: "statusAberta",
  PREENCHIDA: "statusPreenchida",
  CANCELADA: "statusCancelada",
  EXPIRADA: "statusExpirada",
};

/**
 * Backlog #3 — "Minhas vagas" do contratante.
 *
 * Um único `GET /api/jobs/mine` (sem filtro) traz as vagas + as contagens por
 * status; as tabs filtram em memória. Evita refetch a cada clique e mantém os
 * números das tabs estáveis (contagens sempre sobre o total, não sobre o filtro).
 */
export function MinhasVagasScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<MyJob[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<TabId>("ALL");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadError(null);
    const res = await apiGet<MineResponse>("/api/jobs/mine");
    if (!res.ok) {
      setLoadError(res.error);
      setLoading(false);
      return;
    }
    setJobs(res.data.jobs ?? []);
    setCounts(res.data.countsByStatus ?? {});
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (tab === "ALL" ? jobs : jobs.filter((job) => job.status === tab)),
    [jobs, tab]
  );

  async function handleDelete(job: MyJob) {
    const ok = confirm(
      `Excluir a vaga "${job.title}"? Ela sai do marketplace (o histórico de candidaturas é mantido). Você pode retomá-la depois em "Canceladas".`
    );
    if (!ok) return;
    setBusyId(job.id);
    setActionError(null);
    setNotice(null);
    const res = await apiDelete(`/api/jobs/${encodeURIComponent(job.id)}`);
    setBusyId(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    setNotice("Vaga cancelada.");
    await load({ silent: true });
  }

  async function handleReopen(job: MyJob) {
    setBusyId(job.id);
    setActionError(null);
    setNotice(null);
    const res = await apiPost(`/api/jobs/${encodeURIComponent(job.id)}/reopen`, {});
    setBusyId(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    setNotice("Vaga reaberta e de volta ao marketplace.");
    await load({ silent: true });
  }

  function countFor(id: TabId): number {
    return counts[id] ?? 0;
  }

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <button
            type="button"
            className={styles.back}
            onClick={() => router.push("/perfil")}
            aria-label="Voltar ao perfil"
          >
            <ChevronLeftIcon size={18} />
          </button>
          <div className={styles.headText}>
            <h1 className={styles.title}>Minhas vagas</h1>
            <p className={styles.subtitle}>
              Acompanhe as candidaturas e gerencie as vagas que você publicou.
            </p>
          </div>
          <Link href="/publicar" className={styles.publish}>
            <PlusIcon size={14} /> Publicar
          </Link>
        </div>
      </header>

      {!loadError && (
        <div className={`${styles.chipRow} no-scrollbar`}>
          {TABS.map((t) => (
            <Chip
              key={t.id}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
              count={countFor(t.id)}
            >
              {t.label}
            </Chip>
          ))}
        </div>
      )}

      {actionError && <div className={styles.banner}>{actionError}</div>}
      {notice && <div className={`${styles.banner} ${styles.bannerOk}`}>{notice}</div>}

      {loading ? (
        <div className={styles.list} aria-hidden="true">
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : loadError ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>Não foi possível carregar suas vagas</span>
          <span className={styles.emptyText}>{loadError}</span>
          <Button size="sm" onClick={() => void load()}>
            Tentar novamente
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <BriefcaseIcon size={26} />
          </span>
          <span className={styles.emptyTitle}>
            {jobs.length === 0 ? "Nenhuma vaga publicada" : "Nenhuma vaga neste filtro"}
          </span>
          <span className={styles.emptyText}>
            {jobs.length === 0
              ? "Publique sua primeira vaga e comece a receber candidaturas."
              : "Troque de aba para ver as vagas em outro status."}
          </span>
          {jobs.length === 0 && (
            <Link href="/publicar" className={styles.emptyCta}>
              <PlusIcon size={15} /> Publicar vaga
            </Link>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {visible.map((job) => {
            const busy = busyId === job.id;
            const location = [job.city, job.state].filter(Boolean).join("/");
            const count = job.applicationsCount;
            const openChat = () => {
              if (job.latestHiringId) router.push(`/mensagens/${job.latestHiringId}`);
            };

            return (
              <article key={job.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <h2 className={styles.cardTitle}>{job.title}</h2>
                  <span className={`${styles.status} ${styles[STATUS_CLASS[job.status]]}`}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </div>

                <div className={styles.metaRow}>
                  <span className={styles.meta}>
                    <CalendarIcon size={13} /> {formatDay(job.startsAt)}
                  </span>
                  {location && (
                    <span className={styles.meta}>
                      <MapPinIcon size={13} /> {location}
                    </span>
                  )}
                </div>

                <div className={styles.priceRow}>
                  <span className={styles.price}>{formatBRLShort(job.valueCents)}</span>
                  <span className={styles.priceUnit}>/ dia</span>
                </div>

                <span className={styles.meta}>
                  <UsersIcon size={13} />
                  {count.total === 0
                    ? "Nenhuma candidatura ainda"
                    : `${count.total} ${count.total === 1 ? "candidatura" : "candidaturas"} · ${count.pending} aguardando`}
                </span>

                <div className={styles.cardActions}>
                  {job.status === "ABERTA" && (
                    <>
                      {count.active > 0 && (
                        <Button size="sm" onClick={() => router.push(`/vaga/${job.id}`)}>
                          <UsersIcon size={14} /> Ver candidatos ({count.active})
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => void handleDelete(job)}
                      >
                        <TrashIcon size={14} /> Excluir
                      </Button>
                    </>
                  )}

                  {job.status === "PREENCHIDA" && (
                    <>
                      <Button size="sm" disabled={!job.latestHiringId} onClick={openChat}>
                        <BriefcaseIcon size={14} /> Ver contratação
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!job.latestHiringId}
                        onClick={openChat}
                      >
                        Ver chat
                      </Button>
                    </>
                  )}

                  {job.status === "CANCELADA" && (
                    <Button size="sm" disabled={busy} onClick={() => void handleReopen(job)}>
                      <RefreshIcon size={14} /> Retomar vaga
                    </Button>
                  )}

                  {job.status === "EXPIRADA" && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => void handleDelete(job)}
                    >
                      <TrashIcon size={14} /> Excluir
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
