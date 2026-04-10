import type { TransitionDecision } from "@/backend/domain/agent";
import type {
  AgentConfig,
  OutputMetadataFieldDef,
  WorkflowTransition,
} from "@/backend/infra/config";
import { parseJson } from "@/backend/utils/json";
import type { Session } from "./index";

export interface SessionRow {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: string;
  transition_decision: string | null;
  agent_config: string;
  status: Session["status"];
  terminal_attach_command: string | null;
  log_file_path: string;
  claude_session_id: string | null;
  step_execution_id: string | null;
  metadata_fields: string | null;
  step_name: string | null;
  workflow_name?: string | null;
  workflow_run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function sessionRowToDomain(row: SessionRow): Session {
  return {
    ...row,
    transitions: parseJson<WorkflowTransition[]>(row.transitions, []),
    transition_decision: parseJson<TransitionDecision | null>(
      row.transition_decision,
      null,
    ),
    agent_config: parseJson<AgentConfig>(row.agent_config, {
      provider: "claude",
    }),
    metadata_fields: parseJson<Record<string, OutputMetadataFieldDef> | null>(
      row.metadata_fields,
      null,
    ),
    workflow_name: row.workflow_name ?? null,
    workflow_run_id: row.workflow_run_id ?? null,
  };
}

export function serializeSessionInsert(params: {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransition[];
  agent_config: AgentConfig;
  log_file_path: string;
  step_execution_id: string | null;
  metadata_fields: Record<string, OutputMetadataFieldDef> | null;
  now: string;
}): SessionRow {
  return {
    ...params,
    transitions: JSON.stringify(params.transitions),
    transition_decision: null,
    agent_config: JSON.stringify(params.agent_config),
    metadata_fields: params.metadata_fields
      ? JSON.stringify(params.metadata_fields)
      : null,
    status: "running",
    terminal_attach_command: null,
    claude_session_id: null,
    step_name: null,
    workflow_name: null,
    workflow_run_id: null,
    created_at: params.now,
    updated_at: params.now,
  };
}
