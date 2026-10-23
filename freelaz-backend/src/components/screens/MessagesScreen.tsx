"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
 * Lista de conversas = contratações com chat criado (o backend só libera a
 * conversa depois do pagamento confirmado). Não existe endpoint de "lista de
 * chats": usamos GET /api/hirings e filtramos aqui.
 *
 * Fase 2.1: cada linha abre `/mensagens/[hiringId]`. Chats ABERTOS e ENCERRADOS
 * aparecem (os encerrados com selo próprio); `AGUARDANDO_PAGAMENTO` fica de
 * fora porque ainda não existe conversa. O backend não expõe contagem de não
 * lidas nem o texto da última mensagem — a lista mostra `lastMessageAt`.
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

  const chats = useMemo(
    () =>
      hirings.filter(
        (hiring) => hiring.chat && hiring.chat.status !== "AGUARDANDO_PAGAMENTO"
      ),
    [hirings]
  );

  const counts = useMemo(
    () => ({
      todas: chats.length,
      contratantes: chats.filter((h) => h.side === "CONTRACTOR").length,
      profissionais: chats.filter((h) => h.side === "PROFESSIONAL").length,
    }),
    [chats]
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return chats
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
  }, [chats, filter, query]);

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
              {chats.length === 0 ? "Nenhuma conversa" : "Nada com esse filtro"}
            </span>
            <span className={styles.emptyText}>
              {chats.length === 0
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
            <Link
              key={hiring.id}
              href={`/mensagens/${hiring.id}`}
              className={styles.row}
            >
              <span className={styles.avatar}>{initials(hiring.counterpart.tradeName || hiring.counterpart.name)}</span>
              <span className={styles.body}>
                <span className={styles.nameRow}>
                  <span className={styles.name}>
                    {hiring.counterpart.tradeName || hiring.counterpart.name}
                  </span>
                  {hiring.chat?.status === "ABERTO" ? (
                    <Badge tone="success">Chat aberto</Badge>
                  ) : (
                    <Badge tone="neutral">Encerrado</Badge>
                  )}
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
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
