import type Database from "better-sqlite3";
import type { SessionStatus } from "../sessions";
import type {
  ListWorkflowRunsFilter,
  StateExecution,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "./index";

export type PreviousExecutionHandoff = {
  state: string;
  handoff_summary: string;
  log_file_path: string | null;
};

export class WorkflowRunRepository {
  constructor(private db: Database.Database) {}

  ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id               TEXT    PRIMARY KEY,
        repository_path  TEXT    NOT NULL,
        worktree_branch  TEXT    NOT NULL,
        workflow_name    TEXT    NOT NULL,
        current_state    TEXT,
        status           TEXT    NOT NULL DEFAULT 'running',
        inputs           TEXT,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS state_executions (
        id                  TEXT    PRIMARY KEY,
        workflow_run_id     TEXT    NOT NULL REFERENCES workflow_runs(id),
        state               TEXT    NOT NULL,
        state_type          TEXT    NOT NULL DEFAULT 'agent',
        command_output      TEXT,
        transition_decision TEXT,
        handoff_summary     TEXT,
        created_at          TEXT    NOT NULL,
        completed_at        TEXT
      );
    `);

    const columns = this.db
      .prepare("PRAGMA table_info(state_executions)")
      .all() as Array<{ name: string }>;
    const hasStateType = columns.some((column) => column.name === "state_type");
    if (!hasStateType) {
      this.db.exec(
        "ALTER TABLE state_executions ADD COLUMN state_type TEXT NOT NULL DEFAULT 'agent'",
      );
    }
  }

  insertStateExecution(params: {
    id: string;
    workflowRunId: string;
    stateName: string;
    stateType: "agent" | "command";
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO state_executions
         (id, workflow_run_id, state, state_type, command_output, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        params.id,
        params.workflowRunId,
        params.stateName,
        params.stateType,
        params.now,
      );
  }

  getStateExecution(id: string): StateExecution | undefined {
    return this.db
      .prepare("SELECT * FROM state_executions WHERE id = ?")
      .get(id) as StateExecution | undefined;
  }

  setStateExecutionCommandOutput(
    id: string,
    commandOutput: string | null,
  ): void {
    this.db
      .prepare("UPDATE state_executions SET command_output = ? WHERE id = ?")
      .run(commandOutput, id);
  }

  completeStateExecution(
    id: string,
    decisionJson: string | null,
    handoffSummary: string | null,
    now: string,
  ): void {
    this.db
      .prepare(
        `UPDATE state_executions SET transition_decision = ?, handoff_summary = ?, completed_at = ? WHERE id = ?`,
      )
      .run(decisionJson, handoffSummary, now, id);
  }

  closeStateExecution(id: string, now: string): void {
    this.db
      .prepare("UPDATE state_executions SET completed_at = ? WHERE id = ?")
      .run(now, id);
  }

  getActiveStateExecution(workflowRunId: string):
    | (StateExecution & {
        session_id: string | null;
        session_status: SessionStatus | null;
      })
    | undefined {
    return this.db
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

  getLastStateExecution(workflowRunId: string): StateExecution | undefined {
    return this.db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(workflowRunId) as StateExecution | undefined;
  }

  listCompletedExecutionsHandoff(workflowRunId: string): Array<{
    state: string;
    handoff_summary: string | null;
    log_file_path: string | null;
  }> {
    return this.db
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

  listCompletedExecutionsHandoffExcluding(
    workflowRunId: string,
    excludeExecutionId: string,
  ): Array<{
    state: string;
    handoff_summary: string | null;
    log_file_path: string | null;
  }> {
    return this.db
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

  insertWorkflowRun(params: {
    id: string;
    repository_path: string;
    worktree_branch: string;
    workflow_name: string;
    initial_state: string;
    inputs_json: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO workflow_runs
         (id, repository_path, worktree_branch, workflow_name, current_state, status, inputs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
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

  getWorkflowRunById(id: string): WorkflowRun | undefined {
    return this.db
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id) as WorkflowRun | undefined;
  }

  getWorkflowRunWithExecutions(
    id: string,
  ): WorkflowRunWithExecutions | undefined {
    const run = this.getWorkflowRunById(id);
    if (!run) return undefined;

    const state_executions = this.db
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

  listWorkflowRuns(filter: ListWorkflowRunsFilter): WorkflowRun[] {
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
    return this.db
      .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY created_at DESC`)
      .all(...params) as WorkflowRun[];
  }

  updateWorkflowRunCurrentState(id: string, state: string, now: string): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET current_state = ?, updated_at = ? WHERE id = ?",
      )
      .run(state, now, id);
  }

  terminateWorkflowRun(
    id: string,
    terminal: "success" | "failure",
    now: string,
  ): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET status = ?, current_state = NULL, updated_at = ? WHERE id = ?",
      )
      .run(terminal, now, id);
  }

  setWorkflowRunRunning(id: string, state: string, now: string): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET status = 'running', current_state = ?, updated_at = ? WHERE id = ?",
      )
      .run(state, now, id);
  }

  // Recovery queries

  listPendingSucceededExecutions(): Array<{
    execution_id: string;
    transition_decision: string | null;
  }> {
    return this.db
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

  listPendingFailedExecutions(): Array<{
    execution_id: string;
    state: string;
    workflow_run_id: string;
  }> {
    return this.db
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

  listOrphanedCommandExecutions(): Array<{
    execution_id: string;
    workflow_run_id: string;
  }> {
    return this.db
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

  closeRemainingFailedExecutions(now: string): void {
    this.db
      .prepare(
        `UPDATE state_executions
     SET completed_at = ?
     WHERE completed_at IS NULL
       AND id IN (
         SELECT state_execution_id FROM sessions WHERE status = 'FAILED' AND state_execution_id IS NOT NULL
       )`,
      )
      .run(now);
  }

  failRemainingRunningWorkflowRuns(now: string): void {
    this.db
      .prepare(
        `UPDATE workflow_runs
     SET status = 'failure', current_state = NULL, updated_at = ?
     WHERE status = 'running'
       AND id NOT IN (
         SELECT workflow_run_id FROM state_executions WHERE completed_at IS NULL
       )`,
      )
      .run(now);
  }
}
