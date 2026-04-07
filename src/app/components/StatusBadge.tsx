import type { ReactNode } from "react";
import styles from "./StatusBadge.module.css";

export type StatusBadgeVariant =
  | "running"
  | "awaiting"
  | "success"
  | "failure"
  | "pending-approval";

interface Props {
  variant: StatusBadgeVariant;
  children: ReactNode;
  className?: string;
}

export default function StatusBadge({ variant, children, className }: Props) {
  const cls = [styles.badge, styles[`badge-${variant}`], className]
    .filter(Boolean)
    .join(" ");
  return <span className={cls}>{children}</span>;
}
