import type { WorkflowRunStatus } from "@/lib/utils/api";
import { syncedAnimationDelay } from "@/lib/utils/syncedAnimationDelay";
import styles from "./StatusDot.module.css";

const BLINK_DURATION_MS = 1500;

const variantClass: Record<WorkflowRunStatus, string> = {
  running: styles.running,
  awaiting: styles.awaiting,
  success: styles.success,
  failure: styles.failure,
};

const blinkingStatuses = new Set<WorkflowRunStatus>(["running", "awaiting"]);

interface Props {
  variant: WorkflowRunStatus;
}

export default function StatusDot({ variant }: Props) {
  return (
    <span
      className={`${styles.dot} ${variantClass[variant]}`}
      style={
        blinkingStatuses.has(variant)
          ? { animationDelay: syncedAnimationDelay(BLINK_DURATION_MS) }
          : undefined
      }
    />
  );
}
