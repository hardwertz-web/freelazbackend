"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/apiClient";
import type { ProposalsResponse } from "@/lib/apiTypes";
import { ChatIcon, HomeIcon, UserIcon, UsersIcon, WalletIcon } from "./Icons";
import styles from "./BottomTabBar.module.css";

/**
 * Tab bar fixa com os 5 itens do MVP (Fase 2.5). "Buscar" deixou de ser uma
 * tela/aba própria: a busca de vagas vive na Home e a de profissionais vive
 * em `/profissionais`.
 */
const TABS = [
  { href: "/", label: "Início", Icon: HomeIcon, match: (path: string) => path === "/" || path.startsWith("/vaga") },
  { href: "/profissionais", label: "Profissionais", Icon: UsersIcon, match: (path: string) => path.startsWith("/profissionais") || path.startsWith("/profissional/") },
  { href: "/mensagens", label: "Mensagens", Icon: ChatIcon, match: (path: string) => path.startsWith("/mensagens") },
  { href: "/carteira", label: "Carteira", Icon: WalletIcon, match: (path: string) => path.startsWith("/carteira") },
  { href: "/perfil", label: "Perfil", Icon: UserIcon, match: (path: string) => path.startsWith("/perfil") },
] as const;

export function BottomTabBar() {
  const pathname = usePathname() ?? "/";
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [p, h] = await Promise.all([
          apiGet<ProposalsResponse>("/api/proposals"),
          apiGet<{ hirings: any[] }>("/api/hirings"),
        ]);
        if (!alive) return;
        const pUnread = (p.ok && (p.data.counts as any)?.unread) ? (p.data.counts as any).unread : (p.ok ? p.data.counts.pending : 0);
        const hUnread = h.ok ? h.data.hirings.reduce((s, x) => s + (x.chat?.unreadCount || 0), 0) : 0;
        setUnreadCount(pUnread + hUnread);
      } catch {
        if (!alive) return;
        setUnreadCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pathname]);

  return (
    <nav className={styles.bar} aria-label="Navegação principal">
      {TABS.map(({ href, label, Icon, match }) => {
        const active = match(pathname);
        const badge = href === "/mensagens" && unreadCount > 0 ? unreadCount : 0;
        return (
          <Link
            key={href}
            href={href}
            className={[styles.item, active && styles.active].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.iconWrap}>
              <Icon size={20} strokeWidth={active ? 2 : 1.8} />
              {badge > 0 && (
                <span className={styles.badge} aria-label={`${badge} não lidas`}>
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
