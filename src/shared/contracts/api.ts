export interface RepositoryDto {
  path: string;
  name: string;
  alias: string;
}

export interface RepositoryDetailDto extends RepositoryDto {
  github_url: string | null;
}

export interface ValidationResultDto {
  valid: boolean;
  reason?: string;
}

export interface WorktreeDto {
  branch: string;
  path: string;
  is_main: boolean;
  is_bare: boolean;
  head: string;
}

export type SessionStatusDto =
  | "running"
  | "awaiting_input"
  | "success"
  | "failure";

export type WorkflowRunStatusDto =
  | "running"
  | "awaiting"
  | "success"
  | "failure";

export type StepExecutionStatusDto =
  | "running"
  | "awaiting"
  | "success"
  | "failure";

export type WorkflowTransitionDto =
  | { step: string; when: string }
  | { terminal: "success" | "failure"; when: string };

export interface AgentConfigDto {
  provider: "claude" | "codex";
  model?: string;
  command?: string;
  permission_mode?: string;
}

export interface OutputMetadataFieldDefDto {
  type: string;
  description?: string;
}

export interface TransitionDecisionDto {
  transition: string;
  reason: string;
  handoff_summary: string;
  clarifying_question?: string;
  metadata?: Record<string, string>;
}

export interface SessionDto {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransitionDto[];
  transition_decision: TransitionDecisionDto | null;
  agent_config?: AgentConfigDto;
  status: SessionStatusDto;
  terminal_attach_command: string | null;
  log_file_path: string;
  claude_session_id: string | null;
  step_execution_id: string | null;
  metadata_fields?: Record<string, OutputMetadataFieldDefDto> | null;
  step_name: string | null;
  workflow_name?: string | null;
  workflow_run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInputDto {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  type?: "text" | "multiline-text";
}

export interface WorkflowSuggestionRuleDto {
  label?: string;
  condition: string;
  inputs?: Record<string, string>;
}

export interface AgentWorkflowStepDto {
  type: "agent";
  goal: string;
  transitions: WorkflowTransitionDto[];
  agent?: Partial<AgentConfigDto>;
  output?: {
    metadata?: Record<string, OutputMetadataFieldDefDto>;
  };
}

export interface CommandWorkflowStepDto {
  type: "command";
  command: string;
  transitions: WorkflowTransitionDto[];
}

export interface ManualApprovalWorkflowStepDto {
  type: "manual-approval";
  transitions: WorkflowTransitionDto[];
}

export type WorkflowStepDto =
  | AgentWorkflowStepDto
  | CommandWorkflowStepDto
  | ManualApprovalWorkflowStepDto;

export interface WorkflowDefinitionDto {
  initial_step: string;
  max_steps?: number;
  inputs?: WorkflowInputDto[];
  recommended_when?: WorkflowSuggestionRuleDto;
  steps: Record<string, WorkflowStepDto>;
}

export interface WorkflowRunDto {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_step: string | null;
  status: WorkflowRunStatusDto;
  inputs: Record<string, string> | null;
  metadata: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface StepExecutionDto {
  id: string;
  workflow_run_id: string;
  step: string;
  step_type: "agent" | "command" | "manual-approval";
  status: StepExecutionStatusDto;
  command_output: string | null;
  session_id: string | null;
  session_status: SessionStatusDto | null;
  transition_decision: TransitionDecisionDto | null;
  handoff_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkflowRunDetailDto extends WorkflowRunDto {
  step_executions: StepExecutionDto[];
}
