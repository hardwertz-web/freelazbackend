import styles from "./Chip.module.css";

type ChipProps = {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Contador opcional (ex.: "Todas 8"). */
  count?: number;
  title?: string;
};

export function Chip({ children, active, onClick, count, title }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[styles.chip, active && styles.active].filter(Boolean).join(" ")}
    >
      {children}
      {count != null && <span className={styles.count}>{count}</span>}
    </button>
  );
}
