import styles from "./Card.module.css";

type CardProps = {
  children: React.ReactNode;
  className?: string;
  /** Sem padding interno (para listas e imagens que encostam na borda). */
  flush?: boolean;
  /** Remove a sombra (cards dentro de cards). */
  plain?: boolean;
};

export function Card({ children, className, flush, plain }: CardProps) {
  const classes = [styles.card, flush && styles.flush, plain && styles.plain, className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}
