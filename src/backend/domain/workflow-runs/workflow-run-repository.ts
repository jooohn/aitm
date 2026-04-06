import type Database from "better-sqlite3";
import type { SessionStatus } from "../sessions";
import type {
  ListWorkflowRunsFilter,
  StepExecution,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "./index";

export type PreviousExecutionHandoff = {
  step: string;
  handoff_summary: string;
  log_file_path: string | null;
};

export class WorkflowRunRepository {
  constructor(private db: Database.Database) {}

  ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id                 TEXT    PRIMARY KEY,
        repository_path    TEXT    NOT NULL,
        worktree_branch    TEXT    NOT NULL,
        workflow_name      TEXT    NOT NULL,
        current_step       TEXT,
        status             TEXT    NOT NULL DEFAULT 'running',
        inputs             TEXT,
        metadata           TEXT,
        step_count_offset  INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT    NOT NULL,
        updated_at         TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS step_executions (
        id                  TEXT    PRIMARY KEY,
        workflow_run_id     TEXT    NOT NULL REFERENCES workflow_runs(id),
        step                TEXT    NOT NULL,
        step_type           TEXT    NOT NULL DEFAULT 'agent',
        command_output      TEXT,
        transition_decision TEXT,
        handoff_summary     TEXT,
        created_at          TEXT    NOT NULL,
        completed_at        TEXT
      );
    `);

    const wrColumns = this.db
      .prepare("PRAGMA table_info(workflow_runs)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(wrColumns.map((c) => c.name));
    if (!columnNames.has("metadata")) {
      this.db.exec("ALTER TABLE workflow_runs ADD COLUMN metadata TEXT");
    }
    if (!columnNames.has("step_count_offset")) {
      this.db.exec(
        "ALTER TABLE workflow_runs ADD COLUMN step_count_offset INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  insertStepExecution(params: {
    id: string;
    workflowRunId: string;
    stepName: string;
    stepType: "agent" | "command" | "manual-approval";
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO step_executions
         (id, workflow_run_id, step, step_type, command_output, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        params.id,
        params.workflowRunId,
        params.stepName,
        params.stepType,
        params.now,
      );
  }

  getStepExecution(id: string): StepExecution | undefined {
    return this.db
      .prepare("SELECT * FROM step_executions WHERE id = ?")
      .get(id) as StepExecution | undefined;
  }

  setStepExecutionCommandOutput(
    id: string,
    commandOutput: string | null,
  ): void {
    this.db
      .prepare("UPDATE step_executions SET command_output = ? WHERE id = ?")
      .run(commandOutput, id);
  }

  completeStepExecution(
    id: string,
    decisionJson: string | null,
    handoffSummary: string | null,
    now: string,
  ): void {
    this.db
      .prepare(
        `UPDATE step_executions SET transition_decision = ?, handoff_summary = ?, completed_at = ? WHERE id = ?`,
      )
      .run(decisionJson, handoffSummary, now, id);
  }

  closeStepExecution(id: string, now: string): void {
    this.db
      .prepare("UPDATE step_executions SET completed_at = ? WHERE id = ?")
      .run(now, id);
  }

  getActiveStepExecution(workflowRunId: string):
    | (StepExecution & {
        session_id: string | null;
        session_status: SessionStatus | null;
      })
    | undefined {
    return this.db
      .prepare(
        `SELECT se.*, s.id AS session_id, s.status AS session_status
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.completed_at IS NULL
       ORDER BY se.created_at DESC
       LIMIT 1`,
      )
      .get(workflowRunId) as
      | (StepExecution & {
          session_id: string | null;
          session_status: SessionStatus | null;
        })
      | undefined;
  }

  countStepExecutions(workflowRunId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM step_executions WHERE workflow_run_id = ?",
      )
      .get(workflowRunId) as { count: number };
    return row.count;
  }

  getLastStepExecution(workflowRunId: string): StepExecution | undefined {
    return this.db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(workflowRunId) as StepExecution | undefined;
  }

  listCompletedExecutionsHandoff(workflowRunId: string): Array<{
    step: string;
    handoff_summary: string | null;
    log_file_path: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT se.step, se.handoff_summary, s.log_file_path
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.completed_at IS NOT NULL
       ORDER BY se.created_at ASC`,
      )
      .all(workflowRunId) as Array<{
      step: string;
      handoff_summary: string | null;
      log_file_path: string | null;
    }>;
  }

  listCompletedExecutionsHandoffExcluding(
    workflowRunId: string,
    excludeExecutionId: string,
  ): Array<{
    step: string;
    handoff_summary: string | null;
    log_file_path: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT se.step, se.handoff_summary, s.log_file_path
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.id != ? AND se.completed_at IS NOT NULL
       ORDER BY se.created_at ASC`,
      )
      .all(workflowRunId, excludeExecutionId) as Array<{
      step: string;
      handoff_summary: string | null;
      log_file_path: string | null;
    }>;
  }

  insertWorkflowRun(params: {
    id: string;
    repository_path: string;
    worktree_branch: string;
    workflow_name: string;
    initial_step: string;
    inputs_json: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO workflow_runs
         (id, repository_path, worktree_branch, workflow_name, current_step, status, inputs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        params.id,
        params.repository_path,
        params.worktree_branch,
        params.workflow_name,
        params.initial_step,
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

    const step_executions = this.db
      .prepare(
        `SELECT se.*, s.id as session_id, s.status as session_status
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ?
       ORDER BY se.created_at ASC`,
      )
      .all(id) as StepExecution[];

    return { ...run, step_executions };
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

  mergeWorkflowRunMetadata(
    id: string,
    newMetadata: Record<string, string>,
  ): void {
    const row = this.db
      .prepare("SELECT metadata FROM workflow_runs WHERE id = ?")
      .get(id) as { metadata: string | null } | undefined;

    const existing: Record<string, string> = row?.metadata
      ? JSON.parse(row.metadata)
      : {};
    const merged = { ...existing, ...newMetadata };

    this.db
      .prepare("UPDATE workflow_runs SET metadata = ? WHERE id = ?")
      .run(JSON.stringify(merged), id);
  }

  updateWorkflowRunCurrentStep(id: string, step: string, now: string): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET current_step = ?, updated_at = ? WHERE id = ?",
      )
      .run(step, now, id);
  }

  terminateWorkflowRun(
    id: string,
    terminal: "success" | "failure",
    now: string,
  ): void {
    if (terminal === "success") {
      this.db
        .prepare(
          "UPDATE workflow_runs SET status = ?, current_step = NULL, updated_at = ? WHERE id = ?",
        )
        .run(terminal, now, id);
    } else {
      // On failure, preserve current_step so the UI knows which step failed
      this.db
        .prepare(
          "UPDATE workflow_runs SET status = ?, updated_at = ? WHERE id = ?",
        )
        .run(terminal, now, id);
    }
  }

  setWorkflowRunAwaiting(id: string, now: string): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET status = 'awaiting', updated_at = ? WHERE id = ?",
      )
      .run(now, id);
  }

  setWorkflowRunRunning(id: string, step: string, now: string): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET status = 'running', current_step = ?, updated_at = ? WHERE id = ?",
      )
      .run(step, now, id);
  }

  setStepCountOffset(id: string, offset: number): void {
    this.db
      .prepare("UPDATE workflow_runs SET step_count_offset = ? WHERE id = ?")
      .run(offset, id);
  }

  findWorkflowRunIdBySessionId(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT se.workflow_run_id
         FROM step_executions se
         JOIN sessions s ON s.step_execution_id = se.id
         WHERE s.id = ?`,
      )
      .get(sessionId) as { workflow_run_id: string } | undefined;
    return row?.workflow_run_id;
  }

  listPendingApprovals(): Array<{
    step_execution_id: string;
    step: string;
    workflow_run_id: string;
    workflow_name: string;
    repository_path: string;
    worktree_branch: string;
    created_at: string;
  }> {
    return this.db
      .prepare(
        `SELECT se.id AS step_execution_id, se.step, se.workflow_run_id,
                wr.workflow_name, wr.repository_path, wr.worktree_branch,
                se.created_at
         FROM step_executions se
         JOIN workflow_runs wr ON se.workflow_run_id = wr.id
         WHERE se.step_type = 'manual-approval'
           AND se.completed_at IS NULL
           AND wr.status IN ('running', 'awaiting')
         ORDER BY se.created_at DESC`,
      )
      .all() as Array<{
      step_execution_id: string;
      step: string;
      workflow_run_id: string;
      workflow_name: string;
      repository_path: string;
      worktree_branch: string;
      created_at: string;
    }>;
  }

  // Recovery queries

  listPendingSucceededExecutions(): Array<{
    execution_id: string;
    transition_decision: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT se.id as execution_id, s.transition_decision
       FROM step_executions se
       JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.completed_at IS NULL AND s.status = 'SUCCEEDED'`,
      )
      .all() as Array<{
      execution_id: string;
      transition_decision: string | null;
    }>;
  }

  listPendingFailedExecutions(): Array<{
    execution_id: string;
    step: string;
    workflow_run_id: string;
  }> {
    return this.db
      .prepare(
        `SELECT se.id as execution_id, se.step, se.workflow_run_id
       FROM step_executions se
       JOIN sessions s ON s.step_execution_id = se.id
       JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE se.completed_at IS NULL AND s.status = 'FAILED' AND wr.status = 'running'`,
      )
      .all() as Array<{
      execution_id: string;
      step: string;
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
       FROM step_executions se
       JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE se.completed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM sessions WHERE step_execution_id = se.id)
         AND se.step_type != 'manual-approval'
         AND wr.status = 'running'`,
      )
      .all() as Array<{ execution_id: string; workflow_run_id: string }>;
  }

  closeRemainingFailedExecutions(now: string): void {
    this.db
      .prepare(
        `UPDATE step_executions
     SET completed_at = ?
     WHERE completed_at IS NULL
       AND id IN (
         SELECT step_execution_id FROM sessions WHERE status = 'FAILED' AND step_execution_id IS NOT NULL
       )`,
      )
      .run(now);
  }

  failRemainingRunningWorkflowRuns(now: string): void {
    this.db
      .prepare(
        `UPDATE workflow_runs
     SET status = 'failure', updated_at = ?
     WHERE status = 'running'
       AND id NOT IN (
         SELECT workflow_run_id FROM step_executions WHERE completed_at IS NULL
       )`,
      )
      .run(now);
  }
}
