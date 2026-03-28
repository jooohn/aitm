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

export async function removeRepository(
  organization: string,
  name: string,
): Promise<void> {
  await apiFetch(`/api/repositories/${organization}/${name}`, {
    method: "DELETE",
  });
}

export function validateRepository(
  organization: string,
  name: string,
): Promise<ValidationResult> {
  return apiFetch(`/api/repositories/${organization}/${name}/validate`);
}

export interface Worktree {
  branch: string;
  path: string;
  is_main: boolean;
  is_bare: boolean;
  head: string;
}

export function fetchWorktrees(
  organization: string,
  name: string,
): Promise<Worktree[]> {
  return apiFetch(`/api/repositories/${organization}/${name}/worktrees`);
}

export function createWorktree(
  organization: string,
  name: string,
  input: { branch: string; no_fetch?: boolean },
): Promise<Worktree> {
  return apiFetch(`/api/repositories/${organization}/${name}/worktrees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function removeWorktree(
  organization: string,
  name: string,
  branch: string,
): Promise<void> {
  await apiFetch(
    `/api/repositories/${organization}/${name}/worktrees/${branch}`,
    { method: "DELETE" },
  );
}

export type SessionStatus =
  | "RUNNING"
  | "WAITING_FOR_INPUT"
  | "SUCCEEDED"
  | "FAILED";

export interface Session {
  id: string;
  repository_id: number;
  worktree_branch: string;
  goal: string;
  completion_condition: string;
  status: SessionStatus;
  terminal_attach_command: string | null;
  log_file_path: string;
  claude_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionMessage {
  id: string;
  session_id: string;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

export function fetchSession(id: string): Promise<Session> {
  return apiFetch(`/api/sessions/${id}`);
}

export function fetchSessionMessages(id: string): Promise<SessionMessage[]> {
  return apiFetch(`/api/sessions/${id}/messages`);
}

export function fetchSessions(
  repositoryId: number,
  worktreeBranch: string,
): Promise<Session[]> {
  const params = new URLSearchParams({
    repository_id: String(repositoryId),
    worktree_branch: worktreeBranch,
  });
  return apiFetch(`/api/sessions?${params}`);
}

export function startSession(input: {
  organization: string;
  name: string;
  worktree_branch: string;
  goal: string;
  completion_condition: string;
}): Promise<Session> {
  return apiFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function failSession(id: string): Promise<Session> {
  return apiFetch(`/api/sessions/${id}/fail`, { method: "POST" });
}

export async function sendMessage(
  sessionId: string,
  content: string,
): Promise<void> {
  await apiFetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
