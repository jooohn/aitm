import type { WorkflowRunStatus } from "@/lib/utils/api";
import styles from "./StatusDot.module.css";

const variantClass: Record<WorkflowRunStatus, string> = {
  running: styles.running,
  awaiting: styles.awaiting,
  success: styles.success,
  failure: styles.failure,
};

interface Props {
  variant: WorkflowRunStatus;
}

export default function StatusDot({ variant }: Props) {
  return <span className={`${styles.dot} ${variantClass[variant]}`} />;
}
