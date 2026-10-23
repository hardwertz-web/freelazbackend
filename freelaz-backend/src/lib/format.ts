// Formatação compartilhada entre as telas. Tudo aqui é puro (sem estado) e
// roda tanto no cliente quanto no servidor.

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return BRL.format(cents / 100);
}

/** "R$ 180" quando o valor é cheio em reais; senão mantém os centavos. */
export function formatBRLShort(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return cents % 100 === 0 ? `R$ ${(cents / 100).toLocaleString("pt-BR")}` : formatBRL(cents);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "Sábado, 18:00 – 02:00" (turno da vaga). */
export function formatShift(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Data a combinar";
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(start);
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${capitalize(weekday)}, ${time.format(start)} – ${time.format(end)}`;
}

/** "23 out" */
export function formatDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "");
  return `${day} ${month}`;
}

/** "Hoje, 10:24" / "Ontem" / "23 out" — para listas de conversa. */
export function formatListTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) {
    return capitalize(new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date)).replace(".", "");
  }
  return formatDay(date);
}

/** "R. Lima" → "RL" — avatar sem imagem no MVP. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Códigos de disponibilidade ("SEG_MANHA") viram "Seg manhã". */
export function humanizeCode(code: string): string {
  const [day, period] = code.split("_");
  const days: Record<string, string> = {
    SEG: "Seg",
    TER: "Ter",
    QUA: "Qua",
    QUI: "Qui",
    SEX: "Sex",
    SAB: "Sáb",
    DOM: "Dom",
  };
  const periods: Record<string, string> = {
    MANHA: "manhã",
    TARDE: "tarde",
    NOITE: "noite",
    INTEEIRO: "dia inteiro",
    INTEIRO: "dia inteiro",
  };
  const d = days[day] ?? day;
  const p = periods[period] ?? (period ? period.toLowerCase() : "");
  return p ? `${d} ${p}` : d;
}

/** "Eventos" a partir de "eventos" — categorias são texto livre no backend. */
export function humanizeCategory(category: string): string {
  return capitalize(category.replace(/[-_]/g, " "));
}
