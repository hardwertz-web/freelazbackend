"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import { apiGet } from "@/lib/apiClient";
import type { JobCard, JobsResponse } from "@/lib/apiTypes";
import { getCategoryImage } from "@/lib/categoryImages";
import { formatBRLShort, formatDay, formatShift } from "@/lib/format";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import {
  BoltIcon,
  BriefcaseIcon,
  BroomIcon,
  CalendarIcon,
  CameraIcon,
  ChefHatIcon,
  ChevronRightIcon,
  GlassIcon,
  GridIcon,
  HammerIcon,
  HeartIcon,
  LeafIcon,
  MapPinIcon,
  MusicIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersIcon,
  SparklesIcon,
  TrayIcon,
  TruckIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
  type IconProps,
} from "@/components/Icons";
import styles from "./HomeScreen.module.css";

type SortKey = "RELEVANCIA" | "DATA" | "VALOR";

/** Abas de modalidade visíveis no MVP. PRESTADORA existe na API, não aqui. */
type ModalityTab = "FREELANCE" | "CLT";

type ModalityData = { items: JobCard[]; total: number; hasMore: boolean };

const EMPTY_MODALITY: ModalityData = { items: [], total: 0, hasMore: false };

const MODALITY_TABS: { key: ModalityTab; label: string }[] = [
  { key: "FREELANCE", label: "Freelance" },
  { key: "CLT", label: "CLT" },
];

/** Lembra a aba escolhida apenas durante a sessão do navegador. */
const TAB_STORAGE_KEY = "freelaz.home.modality";

function isModalityTab(value: string | null): value is ModalityTab {
  return value === "FREELANCE" || value === "CLT";
}

/** Normaliza categoria/cidade para comparar "eventos" com "EVENTOS". */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** "EVENTOS" / "eventos" → "Eventos" (o backend grava as duas formas). */
function categoryLabel(raw: string): string {
  const clean = raw.trim().replace(/[-_]/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

const CATEGORY_ICONS: Record<string, ComponentType<IconProps>> = {
  eventos: SparklesIcon,
  festa: SparklesIcon,
  bartender: GlassIcon,
  bar: GlassIcon,
  garcom: TrayIcon,
  garconete: TrayIcon,
  diarista: BroomIcon,
  faxina: BroomIcon,
  limpeza: BroomIcon,
  pedreiro: HammerIcon,
  construcao: HammerIcon,
  eletricista: BoltIcon,
  encanador: WrenchIcon,
  seguranca: ShieldCheckIcon,
  fotografo: CameraIcon,
  motorista: TruckIcon,
  jardineiro: LeafIcon,
  dj: MusicIcon,
  musica: MusicIcon,
  cozinheiro: ChefHatIcon,
  cozinha: ChefHatIcon,
  recepcionista: UserIcon,
  administracao: BriefcaseIcon,
};

function iconForCategory(key: string) {
  return CATEGORY_ICONS[key] ?? GridIcon;
}

function locationOf(job: JobCard): string {
  // Cidade/UF da vaga com fallback para a empresa (vagas antigas).
  const city = job.city ?? job.contractor.city;
  const state = job.state ?? job.contractor.state;
  if (city && state) return `${city} - ${state}`;
  if (city) return city;
  if (state) return state;
  return "Local a combinar";
}

/** "18:00 – 02:00" (o dia já aparece em `formatDay`). */
function timeOf(job: JobCard): string {
  const shift = formatShift(job.startsAt, job.endsAt);
  return shift.split(",").slice(1).join(",").trim() || "Horário a combinar";
}

/** Cor decorativa estável por categoria (a vaga não tem imagem no backend). */
const TONES: [string, string][] = [
  ["#0066ff", "#4d94ff"],
  ["#0b1f44", "#2c5387"],
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

export function HomeScreen({ canPublish = false }: { canPublish?: boolean }) {
  const [byModality, setByModality] = useState<Record<ModalityTab, ModalityData>>({
    FREELANCE: EMPTY_MODALITY,
    CLT: EMPTY_MODALITY,
  });
  const [tab, setTab] = useState<ModalityTab>("FREELANCE");
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
    // As duas modalidades em paralelo: trocar de aba fica instantâneo e cada
    // contador vem do `total` real da própria modalidade. A API limita a 50
    // por página; `total` informa quantas existem.
    const [freelance, clt] = await Promise.all([
      apiGet<JobsResponse>("/api/jobs?limit=50&modality=FREELANCE"),
      apiGet<JobsResponse>("/api/jobs?limit=50&modality=CLT"),
    ]);
    if (freelance.ok && clt.ok) {
      setByModality({
        FREELANCE: {
          items: freelance.data.items,
          total: freelance.data.total,
          hasMore: freelance.data.hasMore,
        },
        CLT: {
          items: clt.data.items,
          total: clt.data.total,
          hasMore: clt.data.hasMore,
        },
      });
    } else if (!freelance.ok) {
      setError(freelance.error);
    } else if (!clt.ok) {
      setError(clt.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // sessionStorage só existe no cliente, então a aba é restaurada depois da
  // montagem (SSR sempre começa em Freelance). Sem storage, fica no default.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(TAB_STORAGE_KEY);
      if (isModalityTab(stored)) setTab(stored);
    } catch {
      /* navegação privada pode bloquear o storage */
    }
  }, []);

  const selectTab = useCallback((next: ModalityTab) => {
    setTab(next);
    // As categorias são derivadas da modalidade ativa: manter a categoria
    // anterior filtraria por algo que pode não existir na outra aba.
    setCategory(null);
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* storage indisponível */
    }
  }, []);

  const { items: jobs, total, hasMore } = byModality[tab];

  /**
   * Categorias derivadas de /api/jobs. A chave é normalizada porque o banco
   * tem "eventos" e "EVENTOS" como categorias distintas — na tela elas são a
   * mesma fileira. O rótulo vem da forma mais legível.
   */
  const categories = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const job of jobs) {
      const key = normalize(job.category);
      if (!key) continue;
      const current = map.get(key);
      if (current) {
        current.count += 1;
      } else {
        map.set(key, { key, label: categoryLabel(job.category), count: 1 });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
      .slice(0, 6);
  }, [jobs]);

  const filterCount =
    (cityFilter.trim() ? 1 : 0) + (minValue.trim() ? 1 : 0) + (maxValue.trim() ? 1 : 0);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const city = normalize(cityFilter);
    const min = minValue.trim() ? Number(minValue) * 100 : null;
    const max = maxValue.trim() ? Number(maxValue) * 100 : null;

    const result = jobs.filter((job) => {
      if (category && normalize(job.category) !== category) return false;

      if (term) {
        const haystack = [
          job.title,
          job.description,
          job.category,
          job.contractor.name,
          job.contractor.tradeName ?? "",
          job.city ?? "",
          job.state ?? "",
          job.contractor.city ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      if (city) {
        const jobCity = normalize(
          `${job.city ?? job.contractor.city ?? ""} ${job.state ?? job.contractor.state ?? ""}`
        );
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

  /** Horizontal: urgentes primeiro, depois as mais recentes (até 5 cards). */
  const nearby = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => {
          if (a.urgentBoost !== b.urgentBoost) return a.urgentBoost ? -1 : 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .slice(0, 5),
    [filtered]
  );

  /**
   * Vertical: as mais recentes. Repete os itens do carrossel de propósito — o
   * carrossel é um recorte de destaque e a lista é o acervo completo (com só 2
   * vagas abertas hoje, excluir as do carrossel deixaria a seção vazia).
   */
  const recent = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [filtered]
  );

  /**
   * "N vagas" do card horizontal: contagem real dentro do que foi carregado
   * (mesma cidade + mesma categoria). Nunca um número inventado.
   */
  const nearbyCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of jobs) {
      const key = `${normalize(candidate.city ?? candidate.contractor.city ?? "")}|${normalize(candidate.category)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return (job: JobCard) =>
      counts.get(`${normalize(job.city ?? job.contractor.city ?? "")}|${normalize(job.category)}`) ?? 1;
  }, [jobs]);

  const hasActiveFilters = Boolean(query.trim() || category || filterCount > 0);

  function clearFilters() {
    setQuery("");
    setCategory(null);
    setCityFilter("");
    setMinValue("");
    setMaxValue("");
    setSort("RELEVANCIA");
  }

  function scrollToList() {
    document.getElementById("lista-vagas")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={[styles.screen, canPublish && styles.screenWithFab].filter(Boolean).join(" ")}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroPhoto} aria-hidden="true" />
        <div className={styles.heroOverlay} aria-hidden="true" />
        <div className={styles.heroContent}>
          <h1 id="hero-title" className={styles.heroTitle}>
            Encontre seu próximo trabalho
          </h1>
          <p className={styles.heroSubtitle}>Vagas de hoje e amanhã, perto de você.</p>
          <span className={styles.heroPill}>
            <MapPinIcon size={14} /> Itajubá - MG
          </span>
          <a
            href="#lista-vagas"
            className={styles.heroButton}
            onClick={(event) => {
              event.preventDefault();
              scrollToList();
              window.history.replaceState(null, "", "#lista-vagas");
            }}
          >
            Ver vagas <span aria-hidden="true">→</span>
          </a>
        </div>
        <span className={styles.heroCredit}>Foto: Deni Williams · CC BY 2.0</span>
      </section>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon size={18} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por profissão, categoria ou empresa"
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

      {categories.length > 0 && (
        <div className={`${styles.categories} no-scrollbar`} role="group" aria-label="Categorias">
          {categories.map(({ key, label, count }) => {
            const Icon = iconForCategory(key);
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                className={[styles.categoryChip, active && styles.categoryChipActive]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={active}
                onClick={() => setCategory(active ? null : key)}
                title={`${label} (${count})`}
              >
                <Icon size={24} strokeWidth={active ? 2 : 1.7} />
                <span className={styles.categoryLabel}>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Abas de modalidade (Fase 2.3c): Freelance é a padrão. Prestadora fica
          de fora do MVP — o backend aceita, a Home não mostra. */}
      <div className={styles.modalityTabs} role="tablist" aria-label="Modalidade das vagas">
        {MODALITY_TABS.map(({ key, label }) => {
          const active = tab === key;
          const count = byModality[key].total;
          return (
            <button
              key={key}
              id={`tab-${key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="resultados-vagas"
              className={[styles.modalityTab, active && styles.modalityTabActive]
                .filter(Boolean)
                .join(" ")}
              onClick={() => selectTab(key)}
            >
              {label}
              <span className={styles.modalityCount}>
                {loading ? "…" : `${count} ${count === 1 ? "vaga" : "vagas"}`}
              </span>
            </button>
          );
        })}
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
          <div className={styles.pillRow}>
            <Chip active={sort === "DATA"} onClick={() => setSort(sort === "DATA" ? "RELEVANCIA" : "DATA")}>
              Data
            </Chip>
            <Chip active={sort === "VALOR"} onClick={() => setSort(sort === "VALOR" ? "RELEVANCIA" : "VALOR")}>
              Valor
            </Chip>
          </div>
          <div className={styles.filterActions}>
            <span className={styles.filterHint}>Filtros aplicados em tempo real</span>
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Limpar
            </Button>
          </div>
        </Card>
      )}

      <div id="resultados-vagas" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {loading && (
          <>
            <div className={styles.section}>
              <div className={styles.skeleton} style={{ height: 20, width: "55%" }} />
              <div className={styles.nearRow}>
                <div className={styles.skeletonCard} />
                <div className={styles.skeletonCard} />
              </div>
            </div>
            <div className={styles.section}>
              <div className={styles.skeleton} style={{ height: 20, width: "45%" }} />
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
            </div>
          </>
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

        {!loading && !error && filtered.length === 0 && (
          <Card>
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>
                {hasActiveFilters
                  ? "Nenhuma vaga encontrada"
                  : `Nenhuma vaga ${tab === "CLT" ? "CLT" : "Freelance"} disponível ainda.`}
              </span>
              <span className={styles.emptyText}>
                {hasActiveFilters
                  ? "Ajuste a busca ou os filtros para ver outras oportunidades."
                  : tab === "CLT"
                    ? "A modalidade CLT chega em breve. Enquanto isso, veja as vagas freelance."
                    : "Novas oportunidades aparecem aqui assim que forem publicadas."}
              </span>
              {hasActiveFilters && (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              )}
            </div>
          </Card>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <section className={styles.section} aria-labelledby="near-title">
              <div className={styles.sectionHead}>
                <h2 id="near-title" className={styles.sectionTitle}>
                  Vagas perto de você
                </h2>
                <button type="button" className={styles.sectionLink} onClick={scrollToList}>
                  Ver todas <ChevronRightIcon size={12} />
                </button>
              </div>

              <div className={`${styles.nearRow} no-scrollbar`}>
                {nearby.map((job) => {
                  const verified = job.contractor.verified;
                  const count = nearbyCount(job);
                  return (
                    <article key={job.id} className={styles.nearCard}>
                      <Link
                        href={`/vaga/${job.id}`}
                        className={styles.nearLink}
                        aria-label={`Ver detalhes de ${job.title}`}
                      />
                      <div className={styles.nearMedia}>
                        <img
                          className={styles.nearPhoto}
                          src={getCategoryImage(job.category)}
                          alt=""
                          loading="lazy"
                        />
                        {verified && (
                          <span className={styles.nearBadge}>
                            <ShieldCheckIcon size={11} /> Verificado
                          </span>
                        )}
                        <button
                          type="button"
                          className={styles.nearHeart}
                          disabled
                          aria-label="Favoritar vaga (Fase 2)"
                          title="Favoritos chegam na Fase 2"
                        >
                          <HeartIcon size={16} />
                        </button>
                      </div>
                      <div className={styles.nearBody}>
                        <span className={styles.nearTitle}>{job.title}</span>
                        <span className={styles.nearMeta}>
                          <CalendarIcon size={13} /> {formatDay(job.startsAt)} · {timeOf(job)}
                        </span>
                        <span className={styles.nearMeta}>
                          <MapPinIcon size={13} /> {locationOf(job)} · {count}{" "}
                          {count === 1 ? "vaga" : "vagas"}
                        </span>
                        <span className={styles.nearPrice}>
                          {formatBRLShort(job.valueCents)}
                          <span className={styles.nearPriceUnit}> /dia</span>
                        </span>
                        <span className={styles.nearDetails}>Ver detalhes</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section id="lista-vagas" className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Oportunidades mais recentes</h2>
                <span className={styles.sectionLink} aria-live="polite">
                  {filtered.length} de {total}
                </span>
              </div>

              {recent.length > 0 && (
                <div className={styles.list}>
                  {recent.map((job) => (
                    <Link key={job.id} href={`/vaga/${job.id}`} className={styles.row}>
                      <span
                        className={styles.rowThumb}
                        style={{ background: gradientFor(job.category) }}
                        aria-hidden="true"
                      >
                        <img
                          className={styles.rowThumbImage}
                          src={getCategoryImage(job.category)}
                          alt=""
                          loading="lazy"
                        />
                      </span>
                      <span className={styles.rowBody}>
                        <span className={styles.rowTitle}>{job.title}</span>
                        <span className={styles.rowMeta}>
                          <span>{formatDay(job.startsAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{timeOf(job)}</span>
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

        {!loading && !error && filtered.length > 0 && hasActiveFilters && (
          <button type="button" className={styles.sectionLink} onClick={clearFilters}>
            Limpar filtros aplicados
          </button>
        )}
      </div>

      {/* FAB de publicar (Fase 2.3c): só para quem tem o papel Contratante
          ativo. O guard real de /publicar é no servidor. */}
      {canPublish && (
        <div className={styles.fabWrap}>
          <Link
            href="/publicar"
            className={styles.fab}
            aria-label="Publicar vaga"
            title="Publicar vaga"
          >
            <PlusIcon size={26} strokeWidth={2.4} />
          </Link>
        </div>
      )}
    </div>
  );
}
