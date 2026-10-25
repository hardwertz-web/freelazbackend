"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon, HomeIcon, UserIcon, WalletIcon } from "./Icons";
import styles from "./BottomTabBar.module.css";

/**
 * Tab bar fixa com os 4 itens do MVP (Fase 2.4a). "Buscar" deixou de ser uma
 * tela/aba própria: a busca vive na Home, logo abaixo do hero.
 */
const TABS = [
  { href: "/", label: "Início", Icon: HomeIcon, match: (path: string) => path === "/" || path.startsWith("/vaga") },
  { href: "/mensagens", label: "Mensagens", Icon: ChatIcon, match: (path: string) => path.startsWith("/mensagens") },
  { href: "/carteira", label: "Carteira", Icon: WalletIcon, match: (path: string) => path.startsWith("/carteira") },
  { href: "/perfil", label: "Perfil", Icon: UserIcon, match: (path: string) => path.startsWith("/perfil") },
] as const;

export function BottomTabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className={styles.bar} aria-label="Navegação principal">
      {TABS.map(({ href, label, Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={[styles.item, active && styles.active].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.iconWrap}>
              <Icon size={20} strokeWidth={active ? 2 : 1.8} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
