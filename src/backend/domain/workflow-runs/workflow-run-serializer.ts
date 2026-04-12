import type { TransitionDecision } from "@/backend/domain/agent";
import { parseJson } from "@/backend/utils/json";
import type {
  StepExecution,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "./index";

export interface WorkflowRunRow {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_step: string | null;
  status: WorkflowRun["status"];
  inputs: string | null;
  metadata: string | null;
  step_count_offset: number;
  created_at: string;
  updated_at: string;
}

export interface StepExecutionRow {
  id: string;
  workflow_run_id: string;
  step: string;
  step_type: StepExecution["step_type"];
  status: StepExecution["status"];
  output_file_path: string | null;
  session_id: string | null;
  session_status: StepExecution["session_status"];
  command_execution_id: string | null;
  transition_decision: string | null;
  handoff_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStringRecord(
  value: string | null,
): Record<string, string> | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;

  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function parseTransitionDecision(
  value: string | null,
): TransitionDecision | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  if (
    typeof parsed.reason !== "string" ||
    typeof parsed.handoff_summary !== "string"
  ) {
    return null;
  }

  const metadata = isRecord(parsed.metadata)
    ? Object.fromEntries(
        Object.entries(parsed.metadata).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;

  return {
    ...(typeof parsed.transition === "string" && parsed.transition
      ? { transition: parsed.transition }
      : {}),
    reason: parsed.reason,
    handoff_summary: parsed.handoff_summary,
    ...(typeof parsed.clarifying_question === "string"
      ? { clarifying_question: parsed.clarifying_question }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function workflowRunRowToDomain(row: WorkflowRunRow): WorkflowRun {
  return {
    ...row,
    inputs: parseStringRecord(row.inputs),
    metadata: parseStringRecord(row.metadata),
  };
}

export function stepExecutionRowToDomain(row: StepExecutionRow): StepExecution {
  return {
    ...row,
    session_id: row.session_id ?? null,
    session_status: row.session_status ?? null,
    command_execution_id: row.command_execution_id ?? null,
    transition_decision: parseTransitionDecision(row.transition_decision),
  };
}

export function workflowRunWithExecutionsToDomain(
  row: WorkflowRunRow,
  executions: StepExecutionRow[],
): WorkflowRunWithExecutions {
  return {
    ...workflowRunRowToDomain(row),
    step_executions: executions.map(stepExecutionRowToDomain),
  };
}
