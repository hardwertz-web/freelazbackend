"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type {
  HiringSummary,
  HiringsResponse,
  Proposal,
  ProposalsResponse,
} from "@/lib/apiTypes";
import { formatBRLShort, formatListTime, formatShift, initials } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { SearchIcon } from "@/components/Icons";
import styles from "./MessagesScreen.module.css";

type Filter = "TODAS" | "CONTRATANTES" | "PROFISSIONAIS" | "PROPOSTAS" | "NAO_LIDAS";

type RespondResponse = {
  application: { hiring: { id: string } | null };
  agreedValueCents: number;
};

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
  const router = useRouter();
  const [hirings, setHirings] = useState<HiringSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<Proposal | null>(null);
  const [filter, setFilter] = useState<Filter>("TODAS");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProposalsError(null);
    const [hiringsResult, proposalsResult] = await Promise.all([
      apiGet<HiringsResponse>("/api/hirings"),
      apiGet<ProposalsResponse>("/api/proposals"),
    ]);
    if (hiringsResult.ok) setHirings(hiringsResult.data.hirings);
    else setError(hiringsResult.error);
    if (proposalsResult.ok) setProposals(proposalsResult.data.proposals);
    else setProposalsError(proposalsResult.error);
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
      // O chip filtra pelo papel DO OUTRO LADO da conversa: se eu sou o
      // contratante (side CONTRACTOR), o outro lado é profissional.
      contratantes: chats.filter((h) => h.side === "PROFESSIONAL").length,
      profissionais: chats.filter((h) => h.side === "CONTRACTOR").length,
      propostas: proposals.length,
      naoLidas: chats.filter((h) => (h.chat?.unreadCount ?? 0) > 0).length,
    }),
    [chats, proposals]
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return chats
      .filter((hiring) => {
        if (filter === "CONTRATANTES" && hiring.side !== "PROFESSIONAL") return false;
        if (filter === "PROFISSIONAIS" && hiring.side !== "CONTRACTOR") return false;
        if (filter === "NAO_LIDAS" && (hiring.chat?.unreadCount ?? 0) <= 0) return false;
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

  const visibleProposals = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return proposals;
    return proposals.filter((proposal) => {
      const haystack = `${proposal.counterpart.name} ${proposal.counterpart.tradeName ?? ""} ${
        proposal.jobPosting.title
      }`.toLowerCase();
      return haystack.includes(term);
    });
  }, [proposals, query]);

  async function respond(proposal: Proposal, decision: "ACCEPT" | "REJECT") {
    setBusyId(proposal.id);
    setActionError(null);
    const result = await apiPost<RespondResponse>(
      `/api/applications/${proposal.id}/respond`,
      { decision }
    );
    if (!result.ok) {
      setActionError(result.error);
      setBusyId(null);
      return;
    }

    if (decision === "ACCEPT") {
      const hiringId = result.data.application?.hiring?.id;
      if (hiringId) {
        // Profissional não paga: vai para a conversa. Contratante segue para o
        // checkout da contratação recém-criada.
        router.push(
          proposal.side === "RECEIVED" ? `/mensagens/${hiringId}` : `/checkout/${hiringId}`
        );
        router.refresh();
        return;
      }
    }

    setBusyId(null);
    await load();
  }

  async function cancelProposal(proposal: Proposal) {
    setBusyId(proposal.id);
    setActionError(null);
    const result = await apiPost(`/api/proposals/${proposal.id}/cancel`, {});
    if (!result.ok) {
      setActionError(result.error);
      setBusyId(null);
      return;
    }
    setBusyId(null);
    await load();
  }

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
        <Chip
          active={filter === "PROPOSTAS"}
          onClick={() => setFilter("PROPOSTAS")}
          count={counts.propostas}
        >
          Propostas
        </Chip>
        <Chip
          active={filter === "NAO_LIDAS"}
          onClick={() => setFilter("NAO_LIDAS")}
          count={counts.naoLidas}
        >
          Não lidas
        </Chip>
      </div>

      {filter === "PROPOSTAS" && (
        <>
          {actionError && (
            <div className={styles.actionError} role="alert">
              {actionError}
            </div>
          )}

          {loading && (
            <div className={styles.list}>
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
            </div>
          )}

          {!loading && proposalsError && (
            <Card>
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>Não foi possível carregar as propostas</span>
                <span className={styles.emptyText}>{proposalsError}</span>
                <Button size="sm" onClick={() => void load()}>
                  Tentar de novo
                </Button>
              </div>
            </Card>
          )}

          {!loading && !proposalsError && visibleProposals.length === 0 && (
            <Card>
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>
                  {proposals.length === 0 ? "Nenhuma proposta" : "Nada com essa busca"}
                </span>
                <span className={styles.emptyText}>
                  {proposals.length === 0
                    ? "Propostas privadas do \"Me contrate\" aparecem aqui para aceitar, contrapropor ou recusar."
                    : "Tente outro termo de busca."}
                </span>
              </div>
            </Card>
          )}

          {!loading && !proposalsError && visibleProposals.length > 0 && (
            <div className={styles.list}>
              {visibleProposals.map((proposal) => {
                const name = proposal.counterpart.tradeName || proposal.counterpart.name;
                const activeStatus =
                  proposal.status === "PENDENTE" || proposal.status === "CONTRAPROPOSTA";
                const busy = busyId === proposal.id;
                const canCancel = proposal.side === "SENT" && proposal.status === "PENDENTE";
                return (
                  <Card key={proposal.id} className={styles.proposalCard}>
                    <div className={styles.proposalHead}>
                      <span className={styles.avatar}>{initials(name)}</span>
                      <span className={styles.body}>
                        <span className={styles.nameRow}>
                          <span className={styles.name}>{name}</span>
                          <Badge tone={proposal.side === "RECEIVED" ? "tag" : "primary"}>
                            {proposal.side === "RECEIVED" ? "Recebida" : "Enviada"}
                          </Badge>
                        </span>
                        <span className={styles.meta}>{proposal.jobPosting.title}</span>
                        <span className={styles.meta}>{formatShift(proposal.jobPosting.startsAt, proposal.jobPosting.endsAt)}</span>
                      </span>
                      <span className={styles.proposalValue}>
                        {formatBRLShort(proposal.valueCents)}
                      </span>
                    </div>

                    {proposal.message && (
                      <p className={styles.proposalMessage}>{proposal.message}</p>
                    )}

                    <div className={styles.proposalStatus}>
                      {proposal.awaitingMe && activeStatus ? (
                        <Badge tone={proposal.status === "CONTRAPROPOSTA" ? "tag" : "primary"}>
                          {proposal.status === "CONTRAPROPOSTA"
                            ? "Contraproposta — aguarda você"
                            : "Aguarda sua resposta"}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Aguardando o outro lado</Badge>
                      )}
                      {proposal.counterOfferValueCents != null &&
                        proposal.counterOfferValueCents !== proposal.jobPosting.valueCents && (
                          <span className={styles.proposalCounter}>
                            Contraproposta: {formatBRLShort(proposal.counterOfferValueCents)}
                          </span>
                        )}
                    </div>

                    {proposal.awaitingMe && activeStatus && (
                      <div className={styles.proposalActions}>
                        <Button
                          size="sm"
                          block
                          disabled={busy}
                          onClick={() => void respond(proposal, "ACCEPT")}
                        >
                          Aceitar
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          block
                          disabled={busy}
                          onClick={() => setCounterFor(proposal)}
                        >
                          Contrapor
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          block
                          disabled={busy}
                          onClick={() => void respond(proposal, "REJECT")}
                        >
                          Recusar
                        </Button>
                      </div>
                    )}

                    {canCancel && (
                      <Button
                        size="sm"
                        variant="danger"
                        block
                        disabled={busy}
                        onClick={() => void cancelProposal(proposal)}
                      >
                        {busy ? "Cancelando..." : "Cancelar proposta"}
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {counterFor && (
            <CounterOfferModal
              proposal={counterFor}
              onClose={() => setCounterFor(null)}
              onDone={() => {
                setCounterFor(null);
                void load();
              }}
            />
          )}
        </>
      )}

      {filter !== "PROPOSTAS" && loading && (
        <div className={styles.list}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      )}

      {filter !== "PROPOSTAS" && !loading && error && (
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

      {filter !== "PROPOSTAS" && !loading && !error && visible.length === 0 && (
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

      {filter !== "PROPOSTAS" && !loading && !error && visible.length > 0 && (
        <div className={styles.list}>
          {visible.map((hiring) => (
            <Link
              key={hiring.id}
              href={`/mensagens/${hiring.id}`}
              className={`${styles.row} ${(hiring.chat?.unreadCount ?? 0) > 0 ? styles.rowUnread : ""}`}
            >
              <span className={styles.avatar}>{initials(hiring.counterpart.tradeName || hiring.counterpart.name)}</span>
              <span className={styles.body}>
                <span className={styles.nameRow}>
                  <span className={styles.name}>
                    {hiring.counterpart.tradeName || hiring.counterpart.name}
                  </span>
                  {hiring.chat?.unreadCount && hiring.chat.unreadCount > 0 ? (
                    <span className={styles.unreadBadge}>
                      {hiring.chat.unreadCount > 9 ? "9+" : hiring.chat.unreadCount}
                    </span>
                  ) : null}
                  {hiring.chat?.status === "ABERTO" ? (
                    <Badge tone="success">Chat aberto</Badge>
                  ) : (
                    <Badge tone="neutral">Encerrado</Badge>
                  )}
                </span>
                {hiring.chat?.lastMessage?.body ? (
                  <span className={styles.meta} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {hiring.chat.lastMessage.body}
                  </span>
                ) : (
                  <span className={styles.meta}>
                    {hiring.side === "CONTRACTOR" ? "Profissional" : "Contratante"} ·{" "}
                    {hiring.jobTitle}
                  </span>
                )}
                <span className={styles.meta}>
                  {hiring.side === "CONTRACTOR" ? "Você contrata" : "Você trabalha"} ·{" "}
                  {formatBRLShort(hiring.grossValueCents)}
                </span>
              </span>
              <span className={styles.right}>
                <span className={styles.time}>{formatListTime(hiring.chat?.lastMessage?.createdAt ?? hiring.chat?.lastMessageAt ?? hiring.createdAt)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function brlToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

/** Contraproposta de uma proposta privada — qualquer lado pode propor. */
function CounterOfferModal({
  proposal,
  onClose,
  onDone,
}: {
  proposal: Proposal;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = brlToCents(value);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cents <= 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await apiPost(`/api/applications/${proposal.id}/counter-offer`, {
      valueCents: cents,
    });
    if (result.ok) {
      onDone();
      return;
    }
    setError(result.error);
    setSubmitting(false);
  }

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={() => !submitting && onClose()}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="counter-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="counter-modal-title" className={styles.modalTitle}>
          Contraproposta
        </h2>
        <p className={styles.modalText}>
          Valor atual: <strong>{formatBRLShort(proposal.valueCents)}</strong>. Proponha um novo
          valor para {proposal.counterpart.tradeName || proposal.counterpart.name}.
        </p>

        <form className={styles.modalForm} onSubmit={handleSubmit}>
          {error && (
            <div className={styles.actionError} role="alert">
              {error}
            </div>
          )}
          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Novo valor (R$)</span>
            <input
              className={styles.modalInput}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="300,00"
              inputMode="decimal"
              autoFocus
              required
            />
          </label>
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={cents <= 0 || submitting}>
              {submitting ? "Enviando..." : "Enviar contraproposta"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
