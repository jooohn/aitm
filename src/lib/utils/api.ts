export interface Repository {
  path: string;
  name: string;
  alias: string;
}

export interface RepositoryDetail extends Repository {
  github_url: string | null;
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

export function fetchRepository(
  organization: string,
  name: string,
): Promise<RepositoryDetail> {
  return apiFetch(`/api/repositories/${organization}/${name}`);
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
  | "AWAITING_INPUT"
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
  step_execution_id: string | null;
  step_name: string | null;
  workflow_name: string | null;
  workflow_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export function fetchSession(id: string): Promise<Session> {
  return apiFetch(`/api/sessions/${id}`);
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

export function fetchSessionsByStatus(
  status: SessionStatus,
): Promise<Session[]> {
  const params = new URLSearchParams({ status });
  return apiFetch(`/api/sessions?${params}`);
}

export async function failSession(id: string): Promise<Session> {
  return apiFetch(`/api/sessions/${id}/fail`, { method: "POST" });
}

export async function replyToSession(
  id: string,
  message: string,
): Promise<Session> {
  return apiFetch(`/api/sessions/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export type WorkflowRunStatus = "running" | "success" | "failure";

export interface WorkflowTransition {
  step?: string;
  terminal?: "success" | "failure";
  when: string;
}

export interface WorkflowStep {
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
  initial_step: string;
  inputs?: WorkflowInput[];
  steps: Record<string, WorkflowStep>;
}

export interface WorkflowRun {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_step: string | null;
  status: WorkflowRunStatus;
  inputs: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepExecution {
  id: string;
  workflow_run_id: string;
  step: string;
  step_type: "agent" | "command" | "manual-approval";
  command_output: string | null;
  session_id: string | null;
  session_status: SessionStatus | null;
  transition_decision: string | null;
  handoff_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkflowRunDetail extends WorkflowRun {
  step_executions: StepExecution[];
}

export function canStopWorkflowRun(run: WorkflowRunDetail): boolean {
  if (run.status !== "running") return false;
  return run.step_executions.some(
    (execution) =>
      execution.completed_at === null && execution.session_id !== null,
  );
}

export function fetchWorkflows(): Promise<Record<string, WorkflowDefinition>> {
  return apiFetch("/api/workflows");
}

export function fetchWorkflowRuns(
  repositoryPath: string,
  worktreeBranch?: string,
): Promise<WorkflowRun[]> {
  const params = new URLSearchParams({ repository_path: repositoryPath });
  if (worktreeBranch) params.set("worktree_branch", worktreeBranch);
  return apiFetch(`/api/workflow-runs?${params}`);
}

export function fetchAllWorkflowRuns(
  status?: WorkflowRunStatus,
): Promise<WorkflowRun[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
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

export function stopWorkflowRun(id: string): Promise<WorkflowRunDetail> {
  return apiFetch(`/api/workflow-runs/${id}/stop`, { method: "POST" });
}

export function rerunWorkflowRun(id: string): Promise<WorkflowRun> {
  return apiFetch(`/api/workflow-runs/${id}/rerun`, { method: "POST" });
}

export function rerunWorkflowRunFromFailedState(
  id: string,
): Promise<WorkflowRunDetail> {
  return apiFetch(`/api/workflow-runs/${id}/rerun-from-failed`, {
    method: "POST",
  });
}

export function resolveManualApproval(
  id: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<WorkflowRunDetail> {
  return apiFetch(`/api/workflow-runs/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason }),
  });
}

export interface PendingApproval {
  step_execution_id: string;
  step: string;
  workflow_run_id: string;
  workflow_name: string;
  repository_path: string;
  worktree_branch: string;
  created_at: string;
}

export function fetchPendingApprovals(): Promise<PendingApproval[]> {
  return apiFetch("/api/pending-approvals");
}
