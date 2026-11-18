"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellIcon } from "./Icons";
import styles from "./NotificationBell.module.css";

const POLL_INTERVAL_MS = 60_000;

type Props = {
  className?: string;
  initialUnreadCount?: number;
};

/** Sino do header: badge de não lidas, polling 60s pausado em background. */
export function NotificationBell({ className, initialUnreadCount = 0 }: Props) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const fetchCountRef = useRef<() => void>(() => {});

  // Ref mantém a closure estável para o efeito de polling não se reassinar.
  fetchCountRef.current = () => {
    fetch("/api/notifications?unreadOnly=1&limit=1", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "unreadCount" in data &&
          typeof (data as { unreadCount: unknown }).unreadCount === "number"
        ) {
          setUnreadCount((data as { unreadCount: number }).unreadCount);
        }
      })
      .catch(() => {
        /* polling silencioso: não polui o console */
      });
  };

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(() => fetchCountRef.current(), POLL_INTERVAL_MS);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        fetchCountRef.current();
        stop();
        start();
      }
    };

    fetchCountRef.current();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const label = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <Link
      href="/notificacoes"
      className={[styles.bellButton, className].filter(Boolean).join(" ")}
      aria-label={unreadCount ? `Notificações (${unreadCount} não lidas)` : "Notificações"}
    >
      <BellIcon size={18} />
      {unreadCount > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {label}
        </span>
      )}
    </Link>
  );
}
