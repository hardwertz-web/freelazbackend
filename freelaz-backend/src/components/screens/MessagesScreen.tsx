"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/apiClient";
import type { HiringSummary, HiringsResponse } from "@/lib/apiTypes";
import { formatBRLShort, formatListTime, initials } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { SearchIcon } from "@/components/Icons";
import styles from "./MessagesScreen.module.css";

type Filter = "TODAS" | "CONTRATANTES" | "PROFISSIONAIS";

/**
 * Lista de conversas = contratações com chat ABERTO (o backend só libera o
 * chat depois do pagamento confirmado). Não existe endpoint de "lista de
 * chats": usamos GET /api/hirings e filtramos aqui.
 *
 * A tela de conversa em si (mensagens) é Fase 2 — por isso as linhas não
 * navegam; mostramos o estado real em vez de um link quebrado.
 */
export function MessagesScreen() {
  const [hirings, setHirings] = useState<HiringSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("TODAS");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiGet<HiringsResponse>("/api/hirings");
    if (result.ok) setHirings(result.data.hirings);
    else setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openChats = useMemo(
    () => hirings.filter((hiring) => hiring.chat?.status === "ABERTO"),
    [hirings]
  );

  const counts = useMemo(
    () => ({
      todas: openChats.length,
      contratantes: openChats.filter((h) => h.side === "CONTRACTOR").length,
      profissionais: openChats.filter((h) => h.side === "PROFESSIONAL").length,
    }),
    [openChats]
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return openChats
      .filter((hiring) => {
        if (filter === "CONTRATANTES" && hiring.side !== "CONTRACTOR") return false;
        if (filter === "PROFISSIONAIS" && hiring.side !== "PROFESSIONAL") return false;
        if (!term) return true;
        const haystack = `${hiring.counterpart.name} ${hiring.counterpart.tradeName ?? ""} ${hiring.jobTitle}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => {
        const aTime = new Date(a.chat?.lastMessageAt ?? a.createdAt).getTime();
        const bTime = new Date(b.chat?.lastMessageAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [openChats, filter, query]);

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Mensagens</h1>
        <p className={styles.subtitle}>Converse com contratantes e profissionais.</p>
      </div>

      <div className={styles.searchBox}>
        <SearchIcon size={17} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar conversa, nome ou vaga..."
          aria-label="Buscar conversa"
          type="search"
        />
      </div>

      <div className={`${styles.chipRow} no-scrollbar`}>
        <Chip active={filter === "TODAS"} onClick={() => setFilter("TODAS")} count={counts.todas}>
          Todas
        </Chip>
        <Chip
          active={filter === "CONTRATANTES"}
          onClick={() => setFilter("CONTRATANTES")}
          count={counts.contratantes}
        >
          Contratantes
        </Chip>
        <Chip
          active={filter === "PROFISSIONAIS"}
          onClick={() => setFilter("PROFISSIONAIS")}
          count={counts.profissionais}
        >
          Profissionais
        </Chip>
      </div>

      {loading && (
        <div className={styles.list}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      )}

      {!loading && error && (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível carregar as conversas</span>
            <span className={styles.emptyText}>{error}</span>
            <Button size="sm" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && visible.length === 0 && (
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>
              {openChats.length === 0 ? "Nenhuma conversa aberta" : "Nada com esse filtro"}
            </span>
            <span className={styles.emptyText}>
              {openChats.length === 0
                ? "O chat abre quando o pagamento de uma contratação é confirmado. Assim que isso acontecer, a conversa aparece aqui."
                : "Tente outro filtro ou limpe a busca."}
            </span>
            {(query || filter !== "TODAS") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("TODAS");
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        </Card>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className={styles.list}>
          {visible.map((hiring) => (
            <div key={hiring.id} className={styles.row}>
              <span className={styles.avatar}>{initials(hiring.counterpart.tradeName || hiring.counterpart.name)}</span>
              <span className={styles.body}>
                <span className={styles.nameRow}>
                  <span className={styles.name}>
                    {hiring.counterpart.tradeName || hiring.counterpart.name}
                  </span>
                  <Badge tone="success">Chat aberto</Badge>
                </span>
                <span className={styles.meta}>{hiring.jobTitle}</span>
                <span className={styles.meta}>
                  {hiring.side === "CONTRACTOR" ? "Você contrata" : "Você trabalha"} ·{" "}
                  {formatBRLShort(hiring.grossValueCents)}
                </span>
              </span>
              <span className={styles.right}>
                <span className={styles.time}>{formatListTime(hiring.chat?.lastMessageAt ?? hiring.createdAt)}</span>
              </span>
            </div>
          ))}
          <span className={styles.note}>
            Abrir a conversa e enviar mensagens chega na Fase 2. Estas são as conversas
            liberadas hoje.
          </span>
        </div>
      )}
    </div>
  );
}
