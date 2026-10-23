"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/apiClient";
import type { JobCard, JobsResponse } from "@/lib/apiTypes";
import { formatBRLShort, formatDay, formatShift, humanizeCategory } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import {
  ChevronRightIcon,
  MapPinIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersIcon,
  XIcon,
} from "@/components/Icons";
import styles from "./HomeScreen.module.css";

type SortKey = "RELEVANCIA" | "DATA" | "VALOR";

const TONES: [string, string][] = [
  ["#0066ff", "#4d94ff"],
  ["#0b1f3b", "#2c5387"],
  ["#16a34a", "#4ade80"],
  ["#f97316", "#fdba74"],
  ["#7c3aed", "#a78bfa"],
];

/** Cor decorativa estável por categoria (a vaga não tem imagem no backend). */
function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const [from, to] = TONES[Math.abs(hash) % TONES.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function locationOf(job: JobCard): string {
  const { city, state } = job.contractor;
  if (city && state) return `${city} - ${state}`;
  if (city) return city;
  if (state) return state;
  return "Local a combinar";
}

function companyOf(job: JobCard): string {
  return job.contractor.tradeName || job.contractor.name;
}

export function HomeScreen({ userName }: { userName: string }) {
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("RELEVANCIA");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // A API limita a 50 por página; `total` informa quantas existem.
    const result = await apiGet<JobsResponse>("/api/jobs?limit=50");
    if (result.ok) {
      setJobs(result.data.items);
      setTotal(result.data.total);
      setHasMore(result.data.hasMore);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ?focus=search (vindo da tab "Buscar") foca o campo da Home.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") !== "search") return;
    const timer = window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) counts.set(job.category, (counts.get(job.category) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [jobs]);

  const filterCount =
    (cityFilter.trim() ? 1 : 0) + (minValue.trim() ? 1 : 0) + (maxValue.trim() ? 1 : 0);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const city = cityFilter.trim().toLowerCase();
    const min = minValue.trim() ? Number(minValue) * 100 : null;
    const max = maxValue.trim() ? Number(maxValue) * 100 : null;

    const result = jobs.filter((job) => {
      if (category && job.category !== category) return false;

      if (term) {
        const haystack = [
          job.title,
          job.description,
          job.category,
          job.contractor.name,
          job.contractor.tradeName ?? "",
          job.contractor.city ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      if (city) {
        const jobCity = `${job.contractor.city ?? ""} ${job.contractor.state ?? ""}`.toLowerCase();
        if (!jobCity.includes(city)) return false;
      }

      if (min != null && Number.isFinite(min) && job.valueCents < min) return false;
      if (max != null && Number.isFinite(max) && job.valueCents > max) return false;

      return true;
    });

    if (sort === "DATA") {
      result.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    } else if (sort === "VALOR") {
      result.sort((a, b) => b.valueCents - a.valueCents);
    }

    return result;
  }, [jobs, category, query, cityFilter, minValue, maxValue, sort]);

  const featured = useMemo(
    () =>
      filtered
        .filter((job) => job.urgentBoost)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 4),
    [filtered]
  );

  const featuredIds = useMemo(() => new Set(featured.map((job) => job.id)), [featured]);

  const recent = useMemo(
    () =>
      filtered
        .filter((job) => !featuredIds.has(job.id))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [filtered, featuredIds]
  );

  const hasActiveFilters = Boolean(query.trim() || category || filterCount > 0);

  function clearFilters() {
    setQuery("");
    setCategory(null);
    setCityFilter("");
    setMinValue("");
    setMaxValue("");
    setSort("RELEVANCIA");
  }

  return (
    <div className={styles.screen}>
      <section className={styles.hero}>
        <h1 className={styles.title}>
          Encontre o trabalho ideal para você.
        </h1>
        <p className={styles.subtitle}>
          Olá, {userName.split(" ")[0]}. Vagas de hoje e amanhã, perto de você.
        </p>

        <div className={styles.searchRow}>
          <div className={styles.searchBox}>
            <SearchIcon size={18} />
            <input
              ref={searchRef}
              className={styles.searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por profissão, categoria ou empresa..."
              aria-label="Buscar vagas"
              type="search"
              enterKeyHint="search"
            />
            {query && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => setQuery("")}
                aria-label="Limpar busca"
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={[styles.filterButton, filtersOpen && styles.filterButtonOpen]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-label="Abrir filtros"
            title="Filtros"
          >
            <SlidersIcon size={20} />
          </button>
        </div>
      </section>

      <div className={`${styles.chipRow} no-scrollbar`}>
        <Chip active={category === null} onClick={() => setCategory(null)}>
          Todas
        </Chip>
        {categories.map(([name, count]) => (
          <Chip
            key={name}
            active={category === name}
            onClick={() => setCategory(category === name ? null : name)}
            count={count}
          >
            {humanizeCategory(name)}
          </Chip>
        ))}
      </div>

      <div className={`${styles.pillRow} no-scrollbar`}>
        <Chip active={sort === "DATA"} onClick={() => setSort(sort === "DATA" ? "RELEVANCIA" : "DATA")}>
          Data
        </Chip>
        <Chip active={sort === "VALOR"} onClick={() => setSort(sort === "VALOR" ? "RELEVANCIA" : "VALOR")}>
          Valor
        </Chip>
        <Chip active={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          Mais filtros{filterCount > 0 ? ` (${filterCount})` : ""}
        </Chip>
      </div>

      {filtersOpen && (
        <Card className={styles.filters}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="filter-city">
              Cidade ou estado
            </label>
            <input
              id="filter-city"
              className={styles.input}
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              placeholder="Ex.: Itajubá"
            />
          </div>
          <div className={styles.filterGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="filter-min">
                Valor mínimo (R$)
              </label>
              <input
                id="filter-min"
                className={styles.input}
                value={minValue}
                onChange={(event) => setMinValue(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                inputMode="numeric"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="filter-max">
                Valor máximo (R$)
              </label>
              <input
                id="filter-max"
                className={styles.input}
                value={maxValue}
                onChange={(event) => setMaxValue(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="Sem limite"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className={styles.filterActions}>
            <span className={styles.filterHint}>Filtros aplicados em tempo real</span>
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Limpar
            </Button>
          </div>
        </Card>
      )}

      {loading && (
        <div className={styles.section}>
          <div className={styles.skeleton} style={{ height: 20, width: "55%" }} />
          <div className={styles.grid}>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      )}

      {!loading && error && (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível carregar as vagas</span>
            <span className={styles.emptyText}>{error}</span>
            <Button size="sm" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && (
        <>
          {featured.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Oportunidades em destaque</h2>
                <span className={styles.sectionLink}>{featured.length} em destaque</span>
              </div>
              <div className={styles.grid}>
                {featured.map((job) => (
                  <Link key={job.id} href={`/vaga/${job.id}`} className={styles.jobCard}>
                    <div className={styles.thumb} style={{ background: gradientFor(job.category) }}>
                      <span className={styles.thumbLabel}>{humanizeCategory(job.category)}</span>
                      <Badge tone="solid">Destaque</Badge>
                    </div>
                    <div className={styles.jobBody}>
                      <span className={styles.jobTitle}>{job.title}</span>
                      <span className={styles.jobMeta}>
                        <MapPinIcon size={12} /> {locationOf(job)}
                      </span>
                      <div className={styles.jobFooter}>
                        <span className={styles.price}>
                          {formatBRLShort(job.valueCents)}
                          <span className={styles.priceUnit}> /dia</span>
                        </span>
                        <span className={styles.details}>Ver detalhes</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Oportunidades mais recentes</h2>
              <span className={styles.sectionLink} aria-live="polite">
                {filtered.length} de {total}
              </span>
            </div>

            {recent.length === 0 ? (
              <Card>
                <div className={styles.empty}>
                  <span className={styles.emptyTitle}>Nenhuma vaga encontrada</span>
                  <span className={styles.emptyText}>
                    Ajuste a busca ou os filtros para ver outras oportunidades.
                  </span>
                  {hasActiveFilters && (
                    <Button size="sm" variant="secondary" onClick={clearFilters}>
                      Limpar filtros
                    </Button>
                  )}
                </div>
              </Card>
            ) : (
              <div className={styles.list}>
                {recent.map((job) => (
                  <Link key={job.id} href={`/vaga/${job.id}`} className={styles.row}>
                    <span
                      className={styles.rowThumb}
                      style={{ background: gradientFor(job.category) }}
                      aria-hidden="true"
                    >
                      {humanizeCategory(job.category).slice(0, 1)}
                    </span>
                    <span className={styles.rowBody}>
                      <span className={styles.rowTitle}>{job.title}</span>
                      <span className={styles.rowMeta}>
                        <span>{formatDay(job.startsAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatShift(job.startsAt, job.endsAt).split(",")[1] ?? ""}</span>
                      </span>
                      <span className={styles.rowMeta}>
                        <MapPinIcon size={12} /> {locationOf(job)}
                        {job.contractor.verified && (
                          <>
                            <span aria-hidden="true">·</span>
                            <ShieldCheckIcon size={12} /> verificada
                          </>
                        )}
                      </span>
                    </span>
                    <span className={styles.rowRight}>
                      <span className={styles.price}>{formatBRLShort(job.valueCents)}</span>
                      <span className={styles.chevron}>
                        <ChevronRightIcon size={16} />
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {hasMore && (
              <span className={styles.filterHint}>
                Mostrando as {jobs.length} primeiras de {total} vagas abertas.
              </span>
            )}
          </section>
        </>
      )}

      {!loading && !error && recent.length > 0 && hasActiveFilters && (
        <button type="button" className={styles.sectionLink} onClick={clearFilters}>
          Limpar filtros aplicados
        </button>
      )}
    </div>
  );
}
