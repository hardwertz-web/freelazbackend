import styles from "./Badge.module.css";

type BadgeProps = {
  children: React.ReactNode;
  tone?: "primary" | "success" | "tag" | "neutral" | "danger" | "solid";
  icon?: React.ReactNode;
};

export function Badge({ children, tone = "neutral", icon }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[tone]].join(" ")}>
      {icon}
      {children}
    </span>
  );
}
