export interface WorkflowRunInputEntry {
  key: string;
  value: string;
}

export function parseWorkflowRunInputs(
  raw: string | null,
): WorkflowRunInputEntry[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    return Object.entries(parsed).flatMap(([key, value]) =>
      typeof value === "string" ? [{ key, value }] : [],
    );
  } catch {
    return [];
  }
}
