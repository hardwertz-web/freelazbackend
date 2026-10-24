"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet, apiPatch, apiPost } from "@/lib/apiClient";
import type { ChatMessage, ChatResponse, HiringDetailResponse } from "@/lib/apiTypes";
import { initials } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChevronLeftIcon, SendIcon } from "@/components/Icons";
import { ShiftCodeCard } from "@/components/ShiftCodeCard";
import styles from "./ChatScreen.module.css";

/** Polling (decisão do produto): sem WebSocket, busca a cada 5s. */
const POLL_MS = 5000;
const MAX_MESSAGE = 2000;

function clock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function statusLabel(status: string | null): string {
  if (status === "ABERTO") return "Chat aberto";
  if (status === "ENCERRADO") return "Encerrado";
  return "Aguardando pagamento";
}

/**
 * Conversa de uma contratação (GET /api/hirings/:id/chat).
 *
 * - histórico vem em ordem cronológica (mais novas no fim);
 * - polling de 5s em vez de WebSocket;
 * - chat oculto (hiddenAt) responde 404 → "Conversa não disponível";
 * - chat ENCERRADO (ou aguardando pagamento) desabilita o envio;
 * - PATCH .../chat/messages/read ao abrir e quando chegam mensagens novas.
 */
export function ChatScreen({ hiringId }: { hiringId: string }) {
  const [counterpart, setCounterpart] = useState<{ name: string; tradeName: string | null } | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [hiring, setHiring] = useState<HiringDetailResponse["hiring"] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);

  const base = `/api/hirings/${encodeURIComponent(hiringId)}`;

  const markRead = useCallback(async () => {
    await apiPatch(`${base}/chat/messages/read`);
  }, [base]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotAvailable(false);

    const [chatResult, hiringResult] = await Promise.all([
      apiGet<ChatResponse>(`${base}/chat`),
      apiGet<HiringDetailResponse>(base),
    ]);

    if (!chatResult.ok) {
      if (chatResult.status === 404) setNotAvailable(true);
      else setError(chatResult.error);
      setLoading(false);
      return;
    }

    if (hiringResult.ok) {
      setCounterpart(hiringResult.data.hiring.counterpart);
      setJobTitle(hiringResult.data.hiring.jobTitle);
      setHiring(hiringResult.data.hiring);
    }

    setStatus(chatResult.data.chat.status);
    setMessages(chatResult.data.messages);
    setLoading(false);

    if (chatResult.data.messages.some((message) => !message.mine && !message.readAt)) {
      void markRead();
    }
  }, [base, markRead]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Polling silencioso: não mexe no alfa/loading da tela. Busca também o
  // hiring para refletir transições de turno (RETIDO → EM_ANDAMENTO →
  // CONCLUIDO) no card de código sem reload.
  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const [chatResult, hiringResult] = await Promise.all([
      apiGet<ChatResponse>(`${base}/chat`),
      apiGet<HiringDetailResponse>(base),
    ]);
    inFlightRef.current = false;

    if (hiringResult.ok) setHiring(hiringResult.data.hiring);

    if (!chatResult.ok) {
      if (chatResult.status === 404) setNotAvailable(true);
      return;
    }

    setStatus(chatResult.data.chat.status);
    setMessages((previous) => {
      const next = chatResult.data.messages;
      const same =
        next.length === previous.length && next.every((message, index) => message.id === previous[index].id);
      return same ? previous : next;
    });

    if (chatResult.data.messages.some((message) => !message.mine && !message.readAt)) {
      void markRead();
    }
  }, [base, markRead]);

  useEffect(() => {
    if (loading || notAvailable || status === "ENCERRADO") return;
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loading, notAvailable, status, refresh]);

  // Scroll para a última mensagem (novas mensagens e primeira carga).
  useEffect(() => {
    if (loading || messages.length === 0) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [loading, messages.length]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setSendError(null);

    const result = await apiPost<{ message: ChatMessage }>(`${base}/chat/messages`, {
      body: text,
    });
    setSending(false);

    if (!result.ok) {
      setSendError(result.error);
      if (result.status === 409) void refresh();
      return;
    }

    setDraft("");
    setMessages((previous) =>
      previous.some((message) => message.id === result.data.message.id)
        ? previous
        : [...previous, result.data.message]
    );
  }

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className={styles.skeleton} />
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} style={{ width: "60%" }} />
      </div>
    );
  }

  if (notAvailable) {
    return (
      <div className={styles.screen}>
        <Link href="/mensagens" className={styles.back}>
          <ChevronLeftIcon size={15} /> Conversas
        </Link>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Conversa não disponível</span>
            <span className={styles.emptyText}>
              Esta conversa foi encerrada e ocultada, ou você não participa dela.
            </span>
            <Link href="/mensagens">
              <Button size="sm">Voltar para mensagens</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.screen}>
        <Link href="/mensagens" className={styles.back}>
          <ChevronLeftIcon size={15} /> Conversas
        </Link>
        <Card>
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Não foi possível abrir a conversa</span>
            <span className={styles.emptyText}>{error}</span>
            <Button size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const name = counterpart ? counterpart.tradeName || counterpart.name : "Conversa";
  const isOpen = status === "ABERTO";

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <Link href="/mensagens" className={styles.back}>
          <ChevronLeftIcon size={15} /> Conversas
        </Link>
        <div className={styles.identity}>
          <span className={styles.avatar}>{initials(name)}</span>
          <span className={styles.identityBody}>
            <span className={styles.name}>{name}</span>
            <span className={styles.job}>{jobTitle}</span>
          </span>
          <Badge tone={isOpen ? "success" : status === "ENCERRADO" ? "neutral" : "tag"}>
            {statusLabel(status)}
          </Badge>
        </div>
      </div>

      {hiring && (
        <ShiftCodeCard
          hiring={hiring}
          onUpdated={(patch) => {
            setHiring((previous) => (previous ? { ...previous, ...patch } : previous));
            void refresh();
          }}
        />
      )}

      <div className={styles.messages} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.chatEmpty}>Nenhuma mensagem ainda. Diga olá.</div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={[styles.messageRow, message.mine ? styles.mine : styles.theirs]
                .filter(Boolean)
                .join(" ")}
            >
              <div className={styles.bubble}>
                <span className={styles.text}>{message.body}</span>
                <span className={styles.time}>
                  {clock(message.createdAt)}
                  {message.mine && message.readAt && (
                    <span className={styles.readMark} title="Lida" aria-label="Lida">
                      ✓
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} className={styles.end} />
      </div>

      <div className={styles.composerWrap}>
        {!isOpen && (
          <div className={styles.notice} role="status">
            {status === "ENCERRADO"
              ? "Conversa encerrada."
              : "O chat é liberado depois que o pagamento for confirmado."}
          </div>
        )}

        {sendError && (
          <div className={styles.sendError} role="alert">
            {sendError}
          </div>
        )}

        <form className={styles.composer} onSubmit={(event) => void send(event)}>
          <input
            className={styles.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={isOpen ? "Escreva uma mensagem..." : "Conversa indisponível"}
            aria-label="Mensagem"
            maxLength={MAX_MESSAGE}
            disabled={!isOpen || sending}
          />
          <Button
            type="submit"
            className={styles.sendButton}
            disabled={!isOpen || sending || draft.trim().length === 0}
            aria-label="Enviar mensagem"
          >
            <SendIcon size={17} />
          </Button>
        </form>
      </div>
    </div>
  );
}
