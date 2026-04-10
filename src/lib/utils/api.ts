import { branchToSlug } from "@/lib/utils/branch-slug";
import type {
  ChatDetailDto,
  ChatDto,
  ChatProposalDto,
  ProcessDto,
  RepositoryDetailDto,
  RepositoryDto,
  SessionDto,
  ValidationResultDto,
  WorkflowDefinitionDto,
  WorkflowRunDetailDto,
  WorkflowRunDto,
  WorkflowRunStatusDto,
  WorktreeDto,
} from "@/shared/contracts/api";

export type Process = ProcessDto;
export type ProcessStatus = ProcessDto["status"];
export type Chat = ChatDto;
export type ChatDetail = ChatDetailDto;
export type ChatProposal = ChatProposalDto;
export type ChatStatus = ChatDto["status"];
export type ChatProposalStatus = ChatProposalDto["status"];
export type Repository = RepositoryDto;
export type RepositoryDetail = RepositoryDetailDto;
export type ValidationResult = ValidationResultDto;
export type Worktree = WorktreeDto;
export type Session = SessionDto;
export type SessionStatus = SessionDto["status"];
export type WorkflowTransition = SessionDto["transitions"][number];
export type WorkflowInput = NonNullable<
  WorkflowDefinitionDto["inputs"]
>[number];
export type WorkflowStep = WorkflowDefinitionDto["steps"][string];
export type WorkflowDefinition = WorkflowDefinitionDto;
export type WorkflowRun = WorkflowRunDto;
export type WorkflowRunStatus = WorkflowRunStatusDto;
export type StepExecution = WorkflowRunDetailDto["step_executions"][number];
export type WorkflowRunDetail = WorkflowRunDetailDto;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.error ?? `Request failed: ${res.status}`,
      res.status,
    );
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
    `/api/repositories/${organization}/${name}/worktrees/${branchToSlug(branch)}`,
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

export function fetchSession(id: string): Promise<Session> {
  return apiFetch(`/api/sessions/${id}`);
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

export function canStopWorkflowRun(run: WorkflowRunDetail): boolean {
  if (run.status !== "running" && run.status !== "awaiting") return false;
  return run.step_executions.some(
    (execution) =>
      execution.completed_at === null && execution.session_id !== null,
  );
}

export function fetchWorkflows(): Promise<Record<string, WorkflowDefinition>> {
  return apiFetch("/api/workflows");
}

export function fetchWorkflowRuns(
  organization: string,
  name: string,
  worktreeBranch?: string,
): Promise<WorkflowRun[]> {
  const params = new URLSearchParams({ organization, name });
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
  organization: string;
  name: string;
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

export function generateBranchName(
  workflow_name: string,
  inputs?: Record<string, string>,
): Promise<{ branch: string }> {
  return apiFetch("/api/branch-name/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow_name, inputs }),
  });
}

export function rerunWorkflowRunFromFailedState(
  id: string,
): Promise<WorkflowRunDetail> {
  return apiFetch(`/api/workflow-runs/${id}/rerun-from-failed`, {
    method: "POST",
  });
}

export interface ArtifactStatus {
  name: string;
  path: string;
  description?: string;
  exists: boolean;
}

export function fetchArtifactStatuses(id: string): Promise<ArtifactStatus[]> {
  return apiFetch(`/api/workflow-runs/${id}/artifacts`);
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

// -- Chat --

export function createChat(organization: string, name: string): Promise<Chat> {
  return apiFetch("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization, name }),
  });
}

export function fetchChats(
  organization: string,
  name: string,
): Promise<Chat[]> {
  const params = new URLSearchParams({ organization, name });
  return apiFetch(`/api/chats?${params}`);
}

export function fetchChat(id: string): Promise<ChatDetail> {
  return apiFetch(`/api/chats/${id}`);
}

export function fetchChatHistory(
  id: string,
): Promise<Record<string, unknown>[]> {
  return apiFetch(`/api/chats/${id}/history`);
}

export function deleteChat(id: string): Promise<void> {
  return apiFetch(`/api/chats/${id}`, { method: "DELETE" });
}

export function sendChatMessage(
  id: string,
  message: string,
): Promise<ChatDetail> {
  return apiFetch(`/api/chats/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export function approveChatProposal(
  chatId: string,
  proposalId: string,
  overrides?: { workflow_name?: string; inputs?: Record<string, string> },
): Promise<{ workflowRunId: string }> {
  return apiFetch(`/api/chats/${chatId}/proposals/${proposalId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides ?? {}),
  });
}

export function rejectChatProposal(
  chatId: string,
  proposalId: string,
  reason?: string,
): Promise<void> {
  return apiFetch(`/api/chats/${chatId}/proposals/${proposalId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

// -- Processes --

function processBasePath(
  organization: string,
  name: string,
  branch: string,
): string {
  return `/api/repositories/${organization}/${name}/worktrees/${branchToSlug(branch)}/processes`;
}

export function fetchProcesses(
  organization: string,
  name: string,
  branch: string,
): Promise<Process[]> {
  return apiFetch(processBasePath(organization, name, branch));
}

export function startProcess(
  organization: string,
  name: string,
  branch: string,
  command: string,
): Promise<Process> {
  return apiFetch(processBasePath(organization, name, branch), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
}

export function stopProcess(
  organization: string,
  name: string,
  branch: string,
  processId: string,
): Promise<Process> {
  return apiFetch(
    `${processBasePath(organization, name, branch)}/${processId}`,
    {
      method: "DELETE",
    },
  );
}
