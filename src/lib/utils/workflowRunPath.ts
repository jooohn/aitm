export function workflowRunPath(run: {
  id: string;
  organization: string;
  name: string;
}): string {
  return `/repositories/${run.organization}/${run.name}/workflow-runs/${run.id}`;
}

export function stepExecutionPath(
  run: { id: string; organization: string; name: string },
  executionId: string,
): string {
  return `${workflowRunPath(run)}/step-executions/${executionId}`;
}

export function sessionPath(
  run: { id: string; organization: string; name: string },
  sessionId: string,
): string {
  return `${workflowRunPath(run)}/sessions/${sessionId}`;
}
