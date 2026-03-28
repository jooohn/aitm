export interface Repository {
  id: number;
  path: string;
  alias: string;
  name: string;
  main_branch: string;
  created_at: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchRepositories(): Promise<Repository[]> {
  return apiFetch("/api/repositories");
}

export function addRepository(input: {
  path: string;
  name?: string;
  main_branch?: string;
}): Promise<Repository> {
  return apiFetch("/api/repositories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function removeRepository(id: number): Promise<void> {
  await apiFetch(`/api/repositories/${id}`, { method: "DELETE" });
}

export function validateRepository(id: number): Promise<ValidationResult> {
  return apiFetch(`/api/repositories/${id}/validate`);
}
