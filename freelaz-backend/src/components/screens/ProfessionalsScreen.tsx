"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/apiClient";
import type { ProfessionalsResponse, ProfessionalSummary } from "@/lib/apiTypes";
import { formatBRLShort, humanizeCategory, initials } from "@/lib/format";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import {
  ChevronRightIcon,
  MapPinIcon,
  SearchIcon,
  ShieldCheckIcon,
  StarIcon,
} from "@/components/Icons";
import styles from "./ProfessionalsScreen.module.css";

const PAGE_SIZE = 12;

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cityLabel(city: string | null, state: string | null): string | null {
  const parts = [city, state].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : null;
}

export function ProfessionalsScreen() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [minRating, setMinRating] = useState(false);

  const [items, setItems] = useState<ProfessionalSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogo base (sem filtros) para montar os chips e as cidades reais.
  const [catalog, setCatalog] = useState<ProfessionalSummary[]>([]);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const buildQuery = useCallback(
    (nextPage: number, q: string) => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(PAGE_SIZE));
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (city) params.set("city", city);
      if (minRating) params.set("minRating", "4");
      return `/api/professionals?${params.toString()}`;
    },
    [category, city, minRating]
  );

  // Primeira carga + catálogo de categorias/cidades (uma única chamada extra).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiGet<ProfessionalsResponse>("/api/professionals?limit=50");
      if (!alive) return;
      if (result.ok) setCatalog(result.data.professionals);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadFirst = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError(null);
    const result = await apiGet<ProfessionalsResponse>(buildQuery(1, debouncedQuery));
    if (requestId.current !== id) return;
    if (result.ok) {
      setItems(result.data.professionals);
      setTotal(result.data.total);
      setPage(result.data.page);
      setHasMore(result.data.hasMore);
    } else {
      setError(result.error);
      setItems([]);
      setTotal(0);
      setHasMore(false);
    }
    setLoading(false);
  }, [buildQuery, debouncedQuery]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    const result = await apiGet<ProfessionalsResponse>(buildQuery(page + 1, debouncedQuery));
    if (requestId.current !== id) {
      setLoadingMore(false);
      return;
    }
    if (result.ok) {
      setItems((current) => [...current, ...result.data.professionals]);
      setPage(result.data.page);
      setHasMore(result.data.hasMore);
    } else {
      setError(result.error);
    }
    setLoadingMore(false);
  }

  const categories = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const professional of catalog) {
      for (const raw of professional.categories) {
        const key = normalize(raw);
        if (!key) continue;
        const current = counts.get(key);
        if (current) current.count += 1;
        else counts.set(key, { key: raw, label: humanizeCategory(raw), count: 1 });
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
      .slice(0, 10);
  }, [catalog]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const professional of [...catalog, ...items]) {
      if (professional.city?.trim()) set.add(professional.city.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [catalog, items]);

  const filtersActive = Boolean(category || city || minRating || debouncedQuery);

  function resetFilters() {
    setCategory(null);
    setCity("");
    setMinRating(false);
    setQuery("");
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Profissionais</h1>
        <p className={styles.hint}>
          Apenas profissionais com foto de perfil aparecem aqui. Adicione sua foto em Perfil → Editar perfil.
        </p>
        <p className={styles.subtitle}>Encontre quem faz acontecer na sua região.</p>
      </div>

      <div className={styles.searchBox}>
        <SearchIcon size={17} />
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome, serviço ou cidade"
          aria-label="Buscar profissionais"
        />
      </div>

      {categories.length > 0 && (
        <div className={styles.chipRow} role="group" aria-label="Filtrar por categoria">
          <Chip active={category == null} onClick={() => setCategory(null)}>
            Todos
          </Chip>
          {categories.map((item) => (
            <Chip
              key={item.key}
              active={normalize(category) === normalize(item.key)}
              onClick={() => setCategory(normalize(category) === normalize(item.key) ? null : item.key)}
              count={item.count}
            >
              {item.label}
            </Chip>
          ))}
        </div>
      )}

      <div className={styles.filterRow}>
        {cities.length > 0 && (
          <select
            className={styles.select}
            value={city}
            onChange={(event) => setCity(event.target.value)}
            aria-label="Filtrar por cidade"
          >
            <option value="">Todas as cidades</option>
            {cities.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={minRating}
            onChange={(event) => setMinRating(event.target.checked)}
          />
          <span>4★ ou mais</span>
        </label>
      </div>

      {!loading && !error && (
        <p className={styles.resultCount}>
          {total === 0
            ? "Nenhum profissional encontrado"
            : `${total} ${total === 1 ? "profissional encontrado" : "profissionais encontrados"}`}
        </p>
      )}

      {loading && (
        <div className={styles.list} aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonCard}>
              <span className={styles.skeletonAvatar} />
              <div className={styles.skeletonLines}>
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLineShort} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível carregar os profissionais</span>
            <span className={styles.emptyText}>{error}</span>
            <Button size="sm" onClick={() => void loadFirst()}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && items.length === 0 && (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Nenhum profissional por aqui</span>
            <span className={styles.emptyText}>
              {filtersActive
                ? "Tente outra busca ou remova os filtros."
                : "Assim que houver profissionais com perfil completo, eles aparecem nesta lista."}
            </span>
            {filtersActive && (
              <Button size="sm" variant="secondary" onClick={resetFilters}>
                Limpar filtros
              </Button>
            )}
          </div>
        </Card>
      )}

      {!loading && !error && items.length > 0 && (
        <div className={styles.list}>
          {items.map((professional) => {
            const location = cityLabel(professional.city, professional.state);
            const hasRating =
              professional.ratingAverage != null && professional.evaluationCount > 0;
            return (
              <Link key={professional.id} href={`/profissional/${professional.id}`} className={styles.cardLink}>
                <Card className={styles.card}>
                  <div className={styles.cardHead}>
                    <span className={styles.avatar}>{initials(professional.name)}</span>
                    <span className={styles.identity}>
                      <span className={styles.nameRow}>
                        <span className={styles.name}>{professional.name}</span>
                        {professional.verificationStatus === "VERIFICADO" && (
                          <span className={styles.verified} title="Perfil verificado">
                            <ShieldCheckIcon size={13} />
                          </span>
                        )}
                      </span>
                      <span className={styles.headline}>
                        {professional.headline ??
                          (professional.categories.length > 0
                            ? professional.categories.map(humanizeCategory).join(" · ")
                            : "Profissional Freelaz")}
                      </span>
                      {location && (
                        <span className={styles.location}>
                          <MapPinIcon size={12} /> {location}
                        </span>
                      )}
                    </span>
                    <ChevronRightIcon size={16} className={styles.chevron} />
                  </div>

                  {professional.bio && <p className={styles.bio}>{professional.bio}</p>}

                  <div className={styles.cardFoot}>
                    <span className={styles.rating}>
                      <StarIcon size={13} filled={hasRating} />
                      {hasRating ? (
                        <>
                          <strong>{professional.ratingAverage!.toFixed(1)}</strong>
                          <span className={styles.ratingCount}>
                            ({professional.evaluationCount})
                          </span>
                        </>
                      ) : (
                        <span className={styles.ratingCount}>Novo no Freelaz</span>
                      )}
                    </span>
                    {professional.referencePriceCents != null && (
                      <span className={styles.price}>
                        a partir de {formatBRLShort(professional.referencePriceCents)}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && !error && hasMore && (
        <Button variant="secondary" block onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "Carregando..." : "Carregar mais"}
        </Button>
      )}
    </div>
  );
}
