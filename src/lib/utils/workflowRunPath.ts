export function workflowRunPath(run: {
  id: string;
  organization: string;
  name: string;
}): string {
  return `/repositories/${run.organization}/${run.name}/workflow-runs/${run.id}`;
}

export function sessionPath(
  run: { id: string; organization: string; name: string },
  sessionId: string,
): string {
  return `${workflowRunPath(run)}/sessions/${sessionId}`;
}
