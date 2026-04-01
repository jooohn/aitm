import { db } from "../../infra/db";
import type { SessionStatus } from "../sessions";
import type {
  ListWorkflowRunsFilter,
  StateExecution,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunWithExecutions,
} from "./index";

export type PreviousExecutionHandoff = {
  state: string;
  handoff_summary: string;
  log_file_path: string | null;
};

export function insertStateExecution(params: {
  id: string;
  workflowRunId: string;
  stateName: string;
  now: string;
}): void {
  db.prepare(
    `INSERT INTO state_executions
       (id, workflow_run_id, state, command_output, transition_decision, handoff_summary, created_at, completed_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
  ).run(params.id, params.workflowRunId, params.stateName, params.now);
}

export function getStateExecution(id: string): StateExecution | undefined {
  return db.prepare("SELECT * FROM state_executions WHERE id = ?").get(id) as
    | StateExecution
    | undefined;
}

export function setStateExecutionCommandOutput(
  id: string,
  commandOutput: string | null,
): void {
  db.prepare("UPDATE state_executions SET command_output = ? WHERE id = ?").run(
    commandOutput,
    id,
  );
}

export function completeStateExecution(
  id: string,
  decisionJson: string | null,
  handoffSummary: string | null,
  now: string,
): void {
  db.prepare(
    `UPDATE state_executions SET transition_decision = ?, handoff_summary = ?, completed_at = ? WHERE id = ?`,
  ).run(decisionJson, handoffSummary, now, id);
}

export function closeStateExecution(id: string, now: string): void {
  db.prepare("UPDATE state_executions SET completed_at = ? WHERE id = ?").run(
    now,
    id,
  );
}

export function getActiveStateExecution(workflowRunId: string):
  | (StateExecution & {
      session_id: string | null;
      session_status: SessionStatus | null;
    })
  | undefined {
  return db
    .prepare(
      `SELECT se.*, s.id AS session_id, s.status AS session_status
       FROM state_executions se
       LEFT JOIN sessions s ON s.state_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.completed_at IS NULL
       ORDER BY se.created_at DESC
       LIMIT 1`,
    )
    .get(workflowRunId) as
    | (StateExecution & {
        session_id: string | null;
        session_status: SessionStatus | null;
      })
    | undefined;
}

export function getLastStateExecution(
  workflowRunId: string,
): StateExecution | undefined {
  return db
    .prepare(
      "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY rowid DESC LIMIT 1",
    )
    .get(workflowRunId) as StateExecution | undefined;
}

export function listCompletedExecutionsHandoff(workflowRunId: string): Array<{
  state: string;
  handoff_summary: string | null;
  log_file_path: string | null;
}> {
  return db
    .prepare(
      `SELECT se.state, se.handoff_summary, s.log_file_path
       FROM state_executions se
       LEFT JOIN sessions s ON s.state_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.completed_at IS NOT NULL
       ORDER BY se.created_at ASC`,
    )
    .all(workflowRunId) as Array<{
    state: string;
    handoff_summary: string | null;
    log_file_path: string | null;
  }>;
}

export function listCompletedExecutionsHandoffExcluding(
  workflowRunId: string,
  excludeExecutionId: string,
): Array<{
  state: string;
  handoff_summary: string | null;
  log_file_path: string | null;
}> {
  return db
    .prepare(
      `SELECT se.state, se.handoff_summary, s.log_file_path
       FROM state_executions se
       LEFT JOIN sessions s ON s.state_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.id != ? AND se.completed_at IS NOT NULL
       ORDER BY se.created_at ASC`,
    )
    .all(workflowRunId, excludeExecutionId) as Array<{
    state: string;
    handoff_summary: string | null;
    log_file_path: string | null;
  }>;
}

export function insertWorkflowRun(params: {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  initial_state: string;
  inputs_json: string | null;
  now: string;
}): void {
  db.prepare(
    `INSERT INTO workflow_runs
       (id, repository_path, worktree_branch, workflow_name, current_state, status, inputs, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
  ).run(
    params.id,
    params.repository_path,
    params.worktree_branch,
    params.workflow_name,
    params.initial_state,
    params.inputs_json,
    params.now,
    params.now,
  );
}

export function getWorkflowRunById(id: string): WorkflowRun | undefined {
  return db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
    | WorkflowRun
    | undefined;
}

export function getWorkflowRunWithExecutions(
  id: string,
): WorkflowRunWithExecutions | undefined {
  const run = getWorkflowRunById(id);
  if (!run) return undefined;

  const state_executions = db
    .prepare(
      `SELECT se.*, s.id as session_id, s.status as session_status
       FROM state_executions se
       LEFT JOIN sessions s ON s.state_execution_id = se.id
       WHERE se.workflow_run_id = ?
       ORDER BY se.created_at ASC`,
    )
    .all(id) as StateExecution[];

  return { ...run, state_executions };
}

export function listWorkflowRuns(
  filter: ListWorkflowRunsFilter,
): WorkflowRun[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.repository_path !== undefined) {
    conditions.push("repository_path = ?");
    params.push(filter.repository_path);
  }
  if (filter.worktree_branch !== undefined) {
    conditions.push("worktree_branch = ?");
    params.push(filter.worktree_branch);
  }
  if (filter.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY created_at DESC`)
    .all(...params) as WorkflowRun[];
}

export function updateWorkflowRunCurrentState(
  id: string,
  state: string,
  now: string,
): void {
  db.prepare(
    "UPDATE workflow_runs SET current_state = ?, updated_at = ? WHERE id = ?",
  ).run(state, now, id);
}

export function terminateWorkflowRun(
  id: string,
  terminal: "success" | "failure",
  now: string,
): void {
  db.prepare(
    "UPDATE workflow_runs SET status = ?, current_state = NULL, updated_at = ? WHERE id = ?",
  ).run(terminal, now, id);
}

export function setWorkflowRunRunning(
  id: string,
  state: string,
  now: string,
): void {
  db.prepare(
    "UPDATE workflow_runs SET status = 'running', current_state = ?, updated_at = ? WHERE id = ?",
  ).run(state, now, id);
}

// Recovery queries

export function listPendingSucceededExecutions(): Array<{
  execution_id: string;
  transition_decision: string | null;
}> {
  return db
    .prepare(
      `SELECT se.id as execution_id, s.transition_decision
       FROM state_executions se
       JOIN sessions s ON s.state_execution_id = se.id
       WHERE se.completed_at IS NULL AND s.status = 'SUCCEEDED'`,
    )
    .all() as Array<{
    execution_id: string;
    transition_decision: string | null;
  }>;
}

export function listPendingFailedExecutions(): Array<{
  execution_id: string;
  state: string;
  workflow_run_id: string;
}> {
  return db
    .prepare(
      `SELECT se.id as execution_id, se.state, se.workflow_run_id
       FROM state_executions se
       JOIN sessions s ON s.state_execution_id = se.id
       JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE se.completed_at IS NULL AND s.status = 'FAILED' AND wr.status = 'running'`,
    )
    .all() as Array<{
    execution_id: string;
    state: string;
    workflow_run_id: string;
  }>;
}

export function listOrphanedCommandExecutions(): Array<{
  execution_id: string;
  workflow_run_id: string;
}> {
  return db
    .prepare(
      `SELECT se.id as execution_id, se.workflow_run_id
       FROM state_executions se
       JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE se.completed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM sessions WHERE state_execution_id = se.id)
         AND wr.status = 'running'`,
    )
    .all() as Array<{ execution_id: string; workflow_run_id: string }>;
}

export function closeRemainingFailedExecutions(now: string): void {
  db.prepare(
    `UPDATE state_executions
     SET completed_at = ?
     WHERE completed_at IS NULL
       AND id IN (
         SELECT state_execution_id FROM sessions WHERE status = 'FAILED' AND state_execution_id IS NOT NULL
       )`,
  ).run(now);
}

export function failRemainingRunningWorkflowRuns(now: string): void {
  db.prepare(
    `UPDATE workflow_runs
     SET status = 'failure', current_state = NULL, updated_at = ?
     WHERE status = 'running'
       AND id NOT IN (
         SELECT workflow_run_id FROM state_executions WHERE completed_at IS NULL
       )`,
  ).run(now);
}
