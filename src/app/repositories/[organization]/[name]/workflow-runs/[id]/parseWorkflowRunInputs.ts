export interface WorkflowRunInputEntry {
  key: string;
  value: string;
}

export function parseWorkflowRunInputs(
  raw: Record<string, string> | null,
): WorkflowRunInputEntry[] {
  if (!raw) return [];
  return Object.entries(raw)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => ({ key, value }));
}
