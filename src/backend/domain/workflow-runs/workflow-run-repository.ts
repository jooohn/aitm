import type Database from "better-sqlite3";
import type { TransitionDecision } from "@/backend/domain/agent";
import type { EventBus } from "@/backend/infra/event-bus";
import { splitAlias } from "@/lib/utils/inferAlias";
import type { SessionStatus } from "../sessions";
import type {
  ListWorkflowRunsFilter,
  StepExecution,
  StepExecutionStatus,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunWithExecutions,
} from "./index";
import {
  parseTransitionDecision,
  type StepExecutionRow,
  stepExecutionRowToDomain,
  type WorkflowRunRow,
  workflowRunRowToDomain,
  workflowRunWithExecutionsToDomain,
} from "./workflow-run-serializer";

export type PreviousExecutionHandoff = {
  step: string;
  handoff_summary: string;
  log_file_path: string | null;
  output_file_path: string | null;
};

type LegacyCommandOutputBackfillRow = {
  id: string;
  command_output: string;
  transition_decision: string | null;
};

export class WorkflowRunRepository {
  constructor(
    private db: Database.Database,
    private eventBus?: EventBus,
  ) {}

  private emitStepExecutionStatusChanged(
    stepExecutionId: string,
    status: StepExecutionStatus,
  ): void {
    if (!this.eventBus) return;

    const row = this.db
      .prepare(
        `SELECT se.workflow_run_id, wr.worktree_branch, wr.repository_path
         FROM step_executions se
         JOIN workflow_runs wr ON wr.id = se.workflow_run_id
         WHERE se.id = ?`,
      )
      .get(stepExecutionId) as
      | {
          workflow_run_id: string;
          worktree_branch: string;
          repository_path: string;
        }
      | undefined;
    if (!row) return;

    const { organization, name } = splitAlias(row.repository_path);
    this.eventBus.emit("step-execution.status-changed", {
      stepExecutionId,
      workflowRunId: row.workflow_run_id,
      branchName: row.worktree_branch,
      repositoryOrganization: organization,
      repositoryName: name,
      status,
    });
  }

  private emitWorkflowRunStatusChanged(
    workflowRunId: string,
    status: WorkflowRunStatus,
  ): void {
    if (!this.eventBus) return;

    const row = this.db
      .prepare(
        "SELECT repository_path, worktree_branch FROM workflow_runs WHERE id = ?",
      )
      .get(workflowRunId) as
      | { repository_path: string; worktree_branch: string }
      | undefined;
    if (!row) return;

    const { organization, name } = splitAlias(row.repository_path);
    this.eventBus.emit("workflow-run.status-changed", {
      workflowRunId,
      branchName: row.worktree_branch,
      repositoryOrganization: organization,
      repositoryName: name,
      status,
    });
  }

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
        output_file_path    TEXT,
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

    const seColumns = this.db
      .prepare("PRAGMA table_info(step_executions)")
      .all() as Array<{ name: string }>;
    const seColumnNames = new Set(seColumns.map((c) => c.name));
    if (!seColumnNames.has("status")) {
      this.db.exec(
        "ALTER TABLE step_executions ADD COLUMN status TEXT NOT NULL DEFAULT 'running'",
      );
    }
    if (!seColumnNames.has("output_file_path")) {
      this.db.exec(
        "ALTER TABLE step_executions ADD COLUMN output_file_path TEXT",
      );
    }
  }

  private hasStepExecutionColumn(name: string): boolean {
    const seColumns = this.db
      .prepare("PRAGMA table_info(step_executions)")
      .all() as Array<{ name: string }>;
    return seColumns.some((column) => column.name === name);
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
         (id, workflow_run_id, step, step_type, output_file_path, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        params.id,
        params.workflowRunId,
        params.stepName,
        params.stepType,
        params.now,
      );

    this.emitStepExecutionStatusChanged(params.id, "running");
  }

  getStepExecution(id: string): StepExecution | undefined {
    const row = this.db
      .prepare("SELECT * FROM step_executions WHERE id = ?")
      .get(id) as StepExecutionRow | undefined;

    return row ? stepExecutionRowToDomain(row) : undefined;
  }

  setStepExecutionStatus(id: string, status: StepExecutionStatus): void {
    const result = this.db
      .prepare(
        "UPDATE step_executions SET status = ? WHERE id = ? AND status != ?",
      )
      .run(status, id, status);
    if (result.changes > 0) {
      this.emitStepExecutionStatusChanged(id, status);
    }
  }

  setStepExecutionOutputFilePath(
    id: string,
    outputFilePath: string | null,
  ): void {
    this.db
      .prepare("UPDATE step_executions SET output_file_path = ? WHERE id = ?")
      .run(outputFilePath, id);
  }

  listLegacyCommandOutputBackfillCandidates(workflowRunId: string): Array<{
    id: string;
    command_output: string;
    transition_decision: TransitionDecision | null;
  }> {
    if (!this.hasStepExecutionColumn("command_output")) {
      return [];
    }

    const rows = this.db
      .prepare(
        `SELECT id, command_output, transition_decision
         FROM step_executions
         WHERE workflow_run_id = ?
           AND step_type = 'command'
           AND output_file_path IS NULL
           AND command_output IS NOT NULL`,
      )
      .all(workflowRunId) as LegacyCommandOutputBackfillRow[];

    return rows.map((row) => ({
      id: row.id,
      command_output: row.command_output,
      transition_decision: parseTransitionDecision(row.transition_decision),
    }));
  }

  backfillLegacyCommandOutput(params: {
    id: string;
    output_file_path: string;
    handoff_summary: string;
    transition_decision_json: string | null;
  }): void {
    const setClauses = [
      "output_file_path = @output_file_path",
      "handoff_summary = @handoff_summary",
      "transition_decision = @transition_decision_json",
    ];
    if (this.hasStepExecutionColumn("command_output")) {
      setClauses.push("command_output = NULL");
    }

    this.db
      .prepare(
        `UPDATE step_executions
         SET ${setClauses.join(", ")}
         WHERE id = @id`,
      )
      .run(params);
  }

  completeStepExecution(
    id: string,
    decisionJson: string | null,
    handoffSummary: string | null,
    now: string,
    status: StepExecutionStatus,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE step_executions
         SET transition_decision = ?, handoff_summary = ?, completed_at = ?, status = ?
         WHERE id = ?
           AND (
             transition_decision IS NOT ?
             OR handoff_summary IS NOT ?
             OR completed_at IS NOT ?
             OR status != ?
           )`,
      )
      .run(
        decisionJson,
        handoffSummary,
        now,
        status,
        id,
        decisionJson,
        handoffSummary,
        now,
        status,
      );

    if (result.changes > 0) {
      this.emitStepExecutionStatusChanged(id, status);
    }
  }

  closeStepExecution(id: string, now: string): void {
    const result = this.db
      .prepare(
        `UPDATE step_executions
         SET completed_at = ?, status = 'failure'
         WHERE id = ?
           AND (completed_at IS NOT ? OR status != 'failure')`,
      )
      .run(now, id, now);

    if (result.changes > 0) {
      this.emitStepExecutionStatusChanged(id, "failure");
    }
  }

  getActiveStepExecution(workflowRunId: string):
    | (StepExecution & {
        session_id: string | null;
        session_status: SessionStatus | null;
      })
    | undefined {
    const row = this.db
      .prepare(
        `SELECT se.*, s.id AS session_id, s.status AS session_status
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.completed_at IS NULL
       ORDER BY se.created_at DESC
       LIMIT 1`,
      )
      .get(workflowRunId) as StepExecutionRow | undefined;

    if (!row) return undefined;
    return stepExecutionRowToDomain(row) as StepExecution & {
      session_id: string | null;
      session_status: SessionStatus | null;
    };
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
    const row = this.db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(workflowRunId) as StepExecutionRow | undefined;

    return row ? stepExecutionRowToDomain(row) : undefined;
  }

  listCompletedExecutionsHandoff(workflowRunId: string): Array<{
    step: string;
    handoff_summary: string | null;
    log_file_path: string | null;
    output_file_path: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT se.step, se.handoff_summary, s.log_file_path, se.output_file_path
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.completed_at IS NOT NULL
       ORDER BY se.created_at ASC`,
      )
      .all(workflowRunId) as Array<{
      step: string;
      handoff_summary: string | null;
      log_file_path: string | null;
      output_file_path: string | null;
    }>;
  }

  listCompletedExecutionsHandoffExcluding(
    workflowRunId: string,
    excludeExecutionId: string,
  ): Array<{
    step: string;
    handoff_summary: string | null;
    log_file_path: string | null;
    output_file_path: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT se.step, se.handoff_summary, s.log_file_path, se.output_file_path
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ? AND se.id != ? AND se.completed_at IS NOT NULL
       ORDER BY se.created_at ASC`,
      )
      .all(workflowRunId, excludeExecutionId) as Array<{
      step: string;
      handoff_summary: string | null;
      log_file_path: string | null;
      output_file_path: string | null;
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

    this.emitWorkflowRunStatusChanged(params.id, "running");
  }

  getWorkflowRunById(id: string): WorkflowRun | undefined {
    const row = this.db
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id) as WorkflowRunRow | undefined;

    return row ? workflowRunRowToDomain(row) : undefined;
  }

  getWorkflowRunWithExecutions(
    id: string,
  ): WorkflowRunWithExecutions | undefined {
    const run = this.db
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id) as WorkflowRunRow | undefined;
    if (!run) return undefined;

    const step_executions = this.db
      .prepare(
        `SELECT se.*, s.id as session_id, s.status as session_status
       FROM step_executions se
       LEFT JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.workflow_run_id = ?
       ORDER BY se.created_at ASC`,
      )
      .all(id) as StepExecutionRow[];

    return workflowRunWithExecutionsToDomain(run, step_executions);
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
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY created_at DESC`)
      .all(...params) as WorkflowRunRow[];

    return rows.map(workflowRunRowToDomain);
  }

  mergeWorkflowRunMetadata(
    id: string,
    newMetadata: Record<string, string>,
  ): void {
    const existing = this.getWorkflowRunById(id)?.metadata ?? {};
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
      const result = this.db
        .prepare(
          `UPDATE workflow_runs
           SET status = ?, current_step = NULL, updated_at = ?
           WHERE id = ?
             AND (status != ? OR current_step IS NOT NULL)`,
        )
        .run(terminal, now, id, terminal);
      if (result.changes > 0) {
        this.emitWorkflowRunStatusChanged(id, terminal);
      }
    } else {
      // On failure, preserve current_step so the UI knows which step failed
      const result = this.db
        .prepare(
          "UPDATE workflow_runs SET status = ?, updated_at = ? WHERE id = ? AND status != ?",
        )
        .run(terminal, now, id, terminal);
      if (result.changes > 0) {
        this.emitWorkflowRunStatusChanged(id, terminal);
      }
    }
  }

  setWorkflowRunAwaiting(id: string, now: string): void {
    const result = this.db
      .prepare(
        "UPDATE workflow_runs SET status = 'awaiting', updated_at = ? WHERE id = ? AND status != 'awaiting'",
      )
      .run(now, id);
    if (result.changes > 0) {
      this.emitWorkflowRunStatusChanged(id, "awaiting");
    }
  }

  setWorkflowRunRunning(id: string, step: string, now: string): void {
    const result = this.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'running', current_step = ?, updated_at = ?
         WHERE id = ?
           AND (status != 'running' OR current_step IS NOT ?)`,
      )
      .run(step, now, id, step);
    if (result.changes > 0) {
      this.emitWorkflowRunStatusChanged(id, "running");
    }
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

  findActiveExecutionBySessionId(
    sessionId: string,
  ): { id: string; workflow_run_id: string } | undefined {
    return this.db
      .prepare(
        `SELECT se.id, se.workflow_run_id
         FROM step_executions se
         JOIN sessions s ON s.step_execution_id = se.id
         WHERE s.id = ? AND se.completed_at IS NULL`,
      )
      .get(sessionId) as { id: string; workflow_run_id: string } | undefined;
  }

  // Recovery queries

  listPendingSucceededExecutions(): Array<{
    execution_id: string;
    transition_decision: TransitionDecision | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT se.id as execution_id, s.transition_decision
       FROM step_executions se
       JOIN sessions s ON s.step_execution_id = se.id
       WHERE se.completed_at IS NULL AND s.status = 'success'`,
      )
      .all() as Array<{
      execution_id: string;
      transition_decision: string | null;
    }>;

    return rows.map((row) => ({
      execution_id: row.execution_id,
      transition_decision: parseTransitionDecision(row.transition_decision),
    }));
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
       WHERE se.completed_at IS NULL AND s.status = 'failure' AND wr.status = 'running'`,
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
         SELECT step_execution_id FROM sessions WHERE status = 'failure' AND step_execution_id IS NOT NULL
       )`,
      )
      .run(now);
  }

  failRemainingRunningWorkflowRuns(now: string): void {
    const affectedRuns = this.db
      .prepare(
        `SELECT id FROM workflow_runs
         WHERE status = 'running'
           AND id NOT IN (
             SELECT workflow_run_id FROM step_executions WHERE completed_at IS NULL
           )`,
      )
      .all() as Array<{ id: string }>;

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

    for (const { id } of affectedRuns) {
      this.emitWorkflowRunStatusChanged(id, "failure");
    }
  }
}
