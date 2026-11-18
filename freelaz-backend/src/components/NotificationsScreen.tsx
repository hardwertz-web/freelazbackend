"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "./Chip";
import { Card } from "./Card";
import { Button } from "./Button";
import { apiGet, apiPatch, apiPost } from "@/lib/apiClient";
import { formatListTime } from "@/lib/format";
import { mapNotification, type NotificationRow, type NotificationsResponse } from "@/lib/notificationView";
import styles from "./NotificationsScreen.module.css";

type Filter = "all" | "unread";

export function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextFilter: Filter) => {
    setLoading(true);
    try {
      const qs = nextFilter === "unread" ? "?unreadOnly=1" : "";
      const result = await apiGet<NotificationsResponse>(`/api/notifications${qs}`);
      if (result.ok) {
        setNotifications((result.data.notifications ?? []).map(mapNotification));
        setUnreadCount(result.data.unreadCount ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const unreadLabel = useMemo(
    () =>
      unreadCount > 0
        ? `${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`
        : "Tudo em dia",
    [unreadCount]
  );

  async function handleOpen(n: NotificationRow) {
    if (!n.readAt) {
      try {
        await apiPatch(`/api/notifications/${n.id}/read`);
        if (filter === "unread") {
          setNotifications((prev) => prev.filter((x) => x.id !== n.id));
        } else {
          setNotifications((prev) =>
            prev.map((x) =>
              x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x
            )
          );
        }
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* não bloquear navegação */
      }
    }
  }

  async function handleMarkAll() {
    await apiPost("/api/notifications/read-all", {});
    await load(filter);
  }

  function renderItem(n: NotificationRow) {
    return (
      <div className={styles.row}>
        {!n.readAt && <span className={styles.dot} aria-label="Não lida" />}
        <div className={styles.content}>
          <div className={styles.title}>{n.title}</div>
          <div className={styles.body}>{n.body}</div>
          <div className={styles.meta}>{formatListTime(n.createdAt)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.titlePage}>Notificações</h1>
          <p className={styles.subtitle}>{unreadLabel}</p>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" onClick={() => void handleMarkAll()}>
            Marcar todas como lidas
          </Button>
        )}
      </div>

      <div className={styles.chips}>
        <Chip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          count={notifications.length}
        >
          Todas
        </Chip>
        <Chip
          active={filter === "unread"}
          onClick={() => setFilter("unread")}
          count={unreadCount}
        >
          Não lidas
        </Chip>
      </div>

      {loading ? (
        <div className={styles.list}>
          {[0, 1, 2].map((i) => (
            <Card key={i} className={styles.skeleton}>
              <div className={styles.row}>
                <div className={styles.content}>
                  <div className={styles.skeletonLine} />
                  <div className={styles.skeletonLine} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <p className={styles.empty}>Nenhuma notificação por aqui.</p>
      ) : (
        <div className={styles.list}>
          {notifications.map((n) => (
            <Card key={n.id} className={styles.item}>
              {n.linkUrl ? (
                <Link
                  href={n.linkUrl}
                  onClick={() => void handleOpen(n)}
                  className={styles.link}
                >
                  {renderItem(n)}
                </Link>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleOpen(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleOpen(n);
                    }
                  }}
                  className={styles.link}
                >
                  {renderItem(n)}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
