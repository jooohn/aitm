import Link from "next/link";
import StatusBadge from "@/app/components/StatusBadge";
import type { WorkflowRun, WorkflowRunStatus } from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import { syncedAnimationDelay } from "@/lib/utils/syncedAnimationDelay";
import { timeAgo } from "@/lib/utils/timeAgo";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import styles from "./WorkflowKanbanBoard.module.css";

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  awaiting: "Awaiting",
  success: "Success",
  failure: "Failure",
};

const BLINK_DURATION_MS = 2000;

const statusCardClass: Partial<Record<WorkflowRunStatus, string>> = {
  failure: styles.cardFailure,
  success: styles.cardSuccess,
  running: styles.cardRunning,
  awaiting: styles.cardAwaiting,
};

const blinkingStatuses = new Set<WorkflowRunStatus>(["running", "awaiting"]);

interface KanbanCardProps {
  run: WorkflowRun;
  showRepo: boolean;
}

export default function KanbanCard({ run, showRepo }: KanbanCardProps) {
  return (
    <Link
      href={workflowRunPath(run)}
      className={[styles.card, statusCardClass[run.status]]
        .filter(Boolean)
        .join(" ")}
      style={
        blinkingStatuses.has(run.status)
          ? { animationDelay: syncedAnimationDelay(BLINK_DURATION_MS) }
          : undefined
      }
    >
      {showRepo && (
        <span className={styles.cardRepo}>
          {inferAlias(run.repository_path)}
        </span>
      )}
      <span className={styles.cardBranch}>{run.worktree_branch}</span>
      <div className={styles.cardMeta}>
        <StatusBadge variant={run.status}>
          {STATUS_LABELS[run.status]}
        </StatusBadge>
        <span>{timeAgo(run.created_at)}</span>
      </div>
    </Link>
  );
}
