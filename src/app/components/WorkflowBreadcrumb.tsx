import Link from "next/link";
import styles from "./WorkflowBreadcrumb.module.css";

interface WorkflowBreadcrumbProps {
  repository: { organization: string; name: string };
  branch: string;
  workflowRun?: { id: string; name: string };
  stepExecution?: { id: string; workflowRunId: string; stepName: string };
  sessionLabel?: string;
}

export default function WorkflowBreadcrumb({
  repository,
  branch,
  workflowRun,
  stepExecution,
  sessionLabel,
}: WorkflowBreadcrumbProps) {
  const repoHref = `/repositories/${repository.organization}/${repository.name}`;

  const hasSession = sessionLabel !== undefined;
  const hasStepExecution = stepExecution !== undefined;
  const hasWorkflowRun = workflowRun !== undefined;

  // Worktree root: nothing beyond the branch → omit breadcrumb entirely.
  if (!hasWorkflowRun && !hasStepExecution && !hasSession) {
    return null;
  }

  return (
    <nav className={styles.breadcrumb}>
      {/* Branch */}
      <Link
        href={`${repoHref}/worktrees/${branch}`}
        className={styles.breadcrumbLink}
      >
        {branch}
      </Link>

      {/* Workflow run */}
      {hasWorkflowRun && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          {hasStepExecution || hasSession ? (
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

      {/* Step execution */}
      {hasStepExecution && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          {hasSession ? (
            <Link
              href={`/workflow-runs/${stepExecution.workflowRunId}/step-executions/${stepExecution.id}`}
              className={styles.breadcrumbLink}
            >
              {stepExecution.stepName}
            </Link>
          ) : (
            <span className={styles.breadcrumbCurrent}>
              {stepExecution.stepName}
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
