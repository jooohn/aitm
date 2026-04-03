import Link from "next/link";
import styles from "./WorkflowBreadcrumb.module.css";

interface WorkflowBreadcrumbProps {
  repository: { organization: string; name: string };
  branch?: string;
  workflowRun?: { id: string; name: string };
  stateExecution?: { id: string; workflowRunId: string; stateName: string };
  sessionLabel?: string;
}

export default function WorkflowBreadcrumb({
  repository,
  branch,
  workflowRun,
  stateExecution,
  sessionLabel,
}: WorkflowBreadcrumbProps) {
  const repoAlias = `${repository.organization}/${repository.name}`;
  const repoHref = `/repositories/${repository.organization}/${repository.name}`;

  // Determine which segment is the last (current page → plain text)
  const hasSession = sessionLabel !== undefined;
  const hasStateExecution = stateExecution !== undefined;
  const hasWorkflowRun = workflowRun !== undefined;
  const hasBranch = branch !== undefined;

  return (
    <nav className={styles.breadcrumb}>
      {/* Repository */}
      {hasBranch || hasWorkflowRun || hasStateExecution || hasSession ? (
        <Link href={repoHref} className={styles.breadcrumbLink}>
          {repoAlias}
        </Link>
      ) : (
        <span className={styles.breadcrumbCurrent}>{repoAlias}</span>
      )}

      {/* Branch */}
      {hasBranch && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          {hasWorkflowRun || hasStateExecution || hasSession ? (
            <Link
              href={`${repoHref}/worktrees/${branch}`}
              className={styles.breadcrumbLink}
            >
              {branch}
            </Link>
          ) : (
            <span className={styles.breadcrumbCurrent}>{branch}</span>
          )}
        </>
      )}

      {/* Workflow run */}
      {hasWorkflowRun && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          {hasStateExecution || hasSession ? (
            <Link
              href={`/workflow-runs/${workflowRun.id}`}
              className={styles.breadcrumbLink}
            >
              {workflowRun.name}
            </Link>
          ) : (
            <span className={styles.breadcrumbCurrent}>{workflowRun.name}</span>
          )}
        </>
      )}

      {/* State execution */}
      {hasStateExecution && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          {hasSession ? (
            <Link
              href={`/workflow-runs/${stateExecution.workflowRunId}/state-executions/${stateExecution.id}`}
              className={styles.breadcrumbLink}
            >
              {stateExecution.stateName}
            </Link>
          ) : (
            <span className={styles.breadcrumbCurrent}>
              {stateExecution.stateName}
            </span>
          )}
        </>
      )}

      {/* Session label */}
      {hasSession && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{sessionLabel}</span>
        </>
      )}
    </nav>
  );
}
