import { inferAlias } from "./inferAlias";

export function workflowRunPath(run: {
  id: string;
  repository_path: string;
}): string {
  return `/repositories/${inferAlias(run.repository_path)}/workflow-runs/${run.id}`;
}

export function stepExecutionPath(
  run: { id: string; repository_path: string },
  executionId: string,
): string {
  return `${workflowRunPath(run)}/step-executions/${executionId}`;
}
