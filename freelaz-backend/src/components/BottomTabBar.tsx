"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChatIcon, HomeIcon, SearchIcon, UserIcon, WalletIcon } from "./Icons";
import styles from "./BottomTabBar.module.css";

const TABS = [
  { href: "/", label: "Início", Icon: HomeIcon, match: (path: string) => path === "/" || path.startsWith("/vaga") },
  { href: "/buscar", label: "Buscar", Icon: SearchIcon, match: (path: string) => path.startsWith("/buscar") },
  { href: "/mensagens", label: "Mensagens", Icon: ChatIcon, match: (path: string) => path.startsWith("/mensagens") },
  { href: "/carteira", label: "Carteira", Icon: WalletIcon, match: (path: string) => path.startsWith("/carteira") },
  { href: "/perfil", label: "Perfil", Icon: UserIcon, match: (path: string) => path.startsWith("/perfil") },
] as const;

/**
 * Tab bar fixa com os 5 itens do MVP. "Buscar" não é uma tela separada: ele
 * leva para a Home com ?focus=search (a busca vive na Home) e, nesse estado,
 * é ele que aparece ativo.
 */
export function BottomTabBar() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const searchFocused = pathname === "/" && searchParams.get("focus") === "search";

  return (
    <nav className={styles.bar} aria-label="Navegação principal">
      {TABS.map(({ href, label, Icon, match }) => {
        const active = href === "/buscar" ? searchFocused : !searchFocused && match(pathname);
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
