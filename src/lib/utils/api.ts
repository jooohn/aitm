export interface Repository {
  path: string;
  name: string;
  alias: string;
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

export async function cleanMergedWorktrees(
  organization: string,
  name: string,
): Promise<void> {
  await apiFetch(
    `/api/repositories/${organization}/${name}/worktrees/clean-merged`,
    { method: "POST" },
  );
}

export type SessionStatus =
  | "RUNNING"
  | "WAITING_FOR_INPUT"
  | "SUCCEEDED"
  | "FAILED";

export interface Session {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: string; // JSON-serialized WorkflowTransition[]
  transition_decision: string | null; // JSON-serialized TransitionDecision
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
  repositoryPath: string,
  worktreeBranch: string,
): Promise<Session[]> {
  const params = new URLSearchParams({
    repository_path: repositoryPath,
    worktree_branch: worktreeBranch,
  });
  return apiFetch(`/api/sessions?${params}`);
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

export type WorkflowRunStatus = "running" | "success" | "failure";

export interface WorkflowTransition {
  state?: string;
  terminal?: "success" | "failure";
  when: string;
}

export interface WorkflowState {
  goal: string;
  transitions: WorkflowTransition[];
}

export interface WorkflowInput {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  type?: "text" | "multiline-text";
}

export interface WorkflowDefinition {
  initial_state: string;
  inputs?: WorkflowInput[];
  states: Record<string, WorkflowState>;
}

export interface WorkflowRun {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_state: string | null;
  status: WorkflowRunStatus;
  inputs: string | null;
  created_at: string;
  updated_at: string;
}

export interface StateExecution {
  id: string;
  workflow_run_id: string;
  state: string;
  session_id: string;
  transition_decision: string | null;
  handoff_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkflowRunDetail extends WorkflowRun {
  state_executions: StateExecution[];
}

export function fetchWorkflows(): Promise<Record<string, WorkflowDefinition>> {
  return apiFetch("/api/workflows");
}

export function fetchWorkflowRuns(
  repositoryPath: string,
  worktreeBranch: string,
): Promise<WorkflowRun[]> {
  const params = new URLSearchParams({
    repository_path: repositoryPath,
    worktree_branch: worktreeBranch,
  });
  return apiFetch(`/api/workflow-runs?${params}`);
}

export function createWorkflowRun(input: {
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  inputs?: Record<string, string>;
}): Promise<WorkflowRun> {
  return apiFetch("/api/workflow-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchWorkflowRun(id: string): Promise<WorkflowRunDetail> {
  return apiFetch(`/api/workflow-runs/${id}`);
}

export function rerunWorkflowRun(id: string): Promise<WorkflowRun> {
  return apiFetch(`/api/workflow-runs/${id}/rerun`, { method: "POST" });
}
