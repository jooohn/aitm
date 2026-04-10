export interface RepositoryDto {
  path: string;
  name: string;
  alias: string;
}

export interface RepositoryCommandDto {
  id: string;
  label: string;
}

export interface RepositoryDetailDto extends RepositoryDto {
  github_url: string | null;
  commands: RepositoryCommandDto[];
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
  transition?: string;
  reason: string;
  handoff_summary: string;
  clarifying_question?: string;
  metadata?: Record<string, string>;
}

export interface SessionDto {
  id: string;
  organization: string;
  name: string;
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

export interface WorkflowArtifactDto {
  name: string;
  path: string;
  description?: string;
}

export interface WorkflowSuggestionRuleDto {
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
  label?: string;
  initial_step: string;
  max_steps?: number;
  inputs?: WorkflowInputDto[];
  artifacts?: WorkflowArtifactDto[];
  recommended_when?: WorkflowSuggestionRuleDto;
  steps: Record<string, WorkflowStepDto>;
}

export interface WorkflowRunDto {
  id: string;
  organization: string;
  name: string;
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
  output_file_path: string | null;
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

// -- Chat --

export type ChatStatusDto = "running" | "awaiting_input" | "idle" | "failed";

export type ChatProposalStatusDto = "pending" | "approved" | "rejected";

export interface ChatDto {
  id: string;
  organization: string;
  name: string;
  title: string | null;
  status: ChatStatusDto;
  created_at: string;
  updated_at: string;
}

export interface ChatProposalDto {
  id: string;
  chat_id: string;
  workflow_name: string;
  inputs: Record<string, string>;
  rationale: string;
  status: ChatProposalStatusDto;
  workflow_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatDetailDto extends ChatDto {
  proposals: ChatProposalDto[];
}

// -- Processes --

export type ProcessStatusDto = "running" | "stopped" | "crashed";

export interface ProcessDto {
  id: string;
  worktree_branch: string;
  command_id: string;
  command_label: string;
  command: string;
  status: ProcessStatusDto;
  pid: number | null;
  exit_code: number | null;
  created_at: string;
  stopped_at: string | null;
}

// Notification stream events (SSE)

export type RepositoryContextDto = {
  repositoryOrganization: string;
  repositoryName: string;
};

export type WorkflowRunContextDto = RepositoryContextDto & {
  workflowRunId: string;
  branchName: string;
};

export type NotificationEvent =
  | {
      type: "house-keeping.sync-status-changed";
      payload: { syncing: boolean };
    }
  | {
      type: "workflow-run.status-changed";
      payload: WorkflowRunContextDto & { status: WorkflowRunStatusDto };
    }
  | {
      type: "step-execution.status-changed";
      payload: WorkflowRunContextDto & {
        stepExecutionId: string;
        status: StepExecutionStatusDto;
      };
    }
  | {
      type: "worktree.changed";
      payload: RepositoryContextDto;
    }
  | {
      type: "process.status-changed";
      payload: RepositoryContextDto & {
        worktreeBranch: string;
        processId: string;
        status: ProcessStatusDto;
      };
    };
