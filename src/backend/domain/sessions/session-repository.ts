import type Database from "better-sqlite3";
import type { TransitionDecision } from "@/backend/domain/agent";
import type { EventBus } from "@/backend/infra/event-bus";
import type { ListSessionsFilter, Session, SessionStatus } from "./index";
import {
  type SessionRow,
  serializeSessionInsert,
  sessionRowToDomain,
} from "./session-serializer";

export class SessionRepository {
  constructor(
    private db: Database.Database,
    private eventBus?: EventBus,
  ) {}

  private emitStatusChanged(
    sessionId: string,
    status: SessionStatus,
    decision?: TransitionDecision | null,
  ): void {
    if (!this.eventBus) return;

    if (status === "success") {
      if (!decision) {
        throw new Error(
          `session.status-changed requires a decision for success sessions: ${sessionId}`,
        );
      }
      this.eventBus.emit("session.status-changed", {
        sessionId,
        status,
        decision,
      });
      return;
    }

    if (status === "failure") {
      this.eventBus.emit("session.status-changed", {
        sessionId,
        status,
        decision: null,
      });
      return;
    }

    this.eventBus.emit("session.status-changed", {
      sessionId,
      status,
    });
  }

  private updateSessionStatus(
    id: string,
    status: SessionStatus,
    now: string,
    whereClause: string,
    params: unknown[] = [],
    decision?: TransitionDecision | null,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET status = ?, updated_at = ?
         WHERE id = ? AND ${whereClause}`,
      )
      .run(status, now, id, ...params);

    if (result.changes > 0) {
      this.emitStatusChanged(id, status, decision);
      return true;
    }

    return false;
  }

  ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                      TEXT    PRIMARY KEY,
        repository_path         TEXT    NOT NULL,
        worktree_branch         TEXT    NOT NULL,
        goal                    TEXT    NOT NULL,
        transitions             TEXT    NOT NULL DEFAULT '[]',
        transition_decision     TEXT,
        agent_config            TEXT    NOT NULL DEFAULT '{"provider":"claude"}',
        status                  TEXT    NOT NULL DEFAULT 'running',
        terminal_attach_command TEXT,
        log_file_path           TEXT    NOT NULL,
        claude_session_id       TEXT,
        step_execution_id      TEXT    REFERENCES step_executions(id),
        metadata_fields         TEXT,
        created_at              TEXT    NOT NULL,
        updated_at              TEXT    NOT NULL
      );
    `);

    const columns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    const hasMetadataFields = columns.some(
      (column) => column.name === "metadata_fields",
    );
    if (!hasMetadataFields) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN metadata_fields TEXT");
    }
  }

  insertSession(params: {
    id: string;
    repository_path: string;
    worktree_branch: string;
    goal: string;
    transitions: Session["transitions"];
    agent_config: Session["agent_config"];
    log_file_path: string;
    step_execution_id: string | null;
    metadata_fields: Session["metadata_fields"];
    now: string;
  }): void {
    const row = serializeSessionInsert(params);

    this.db
      .prepare(
        `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, agent_config, status, terminal_attach_command, log_file_path,
          claude_session_id, step_execution_id, metadata_fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'running', NULL, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.repository_path,
        row.worktree_branch,
        row.goal,
        row.transitions,
        row.agent_config,
        row.log_file_path,
        row.step_execution_id,
        row.metadata_fields,
        row.created_at,
        row.updated_at,
      );
  }

  getSession(id: string): Session | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*, se.step AS step_name, wr.workflow_name, wr.id AS workflow_run_id
       FROM sessions s
       LEFT JOIN step_executions se ON se.id = s.step_execution_id
       LEFT JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE s.id = ?`,
      )
      .get(id) as SessionRow | undefined;

    return row ? sessionRowToDomain(row) : undefined;
  }

  getSessionStatus(id: string): SessionStatus | null {
    const row = this.db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(id) as { status: SessionStatus } | undefined;
    return row?.status ?? null;
  }

  getAgentSessionId(id: string): string | null {
    const row = this.db
      .prepare("SELECT claude_session_id FROM sessions WHERE id = ?")
      .get(id) as { claude_session_id: string | null } | undefined;
    return row?.claude_session_id ?? null;
  }

  listSessions(filter: ListSessionsFilter = {}): Session[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filter.repository_path !== undefined) {
      conditions.push("s.repository_path = ?");
      params.push(filter.repository_path);
    }
    if (filter.worktree_branch !== undefined) {
      conditions.push("s.worktree_branch = ?");
      params.push(filter.worktree_branch);
    }
    if (filter.status !== undefined) {
      conditions.push("s.status = ?");
      params.push(filter.status);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT s.*, se.step AS step_name, wr.workflow_name, wr.id AS workflow_run_id
       FROM sessions s
       LEFT JOIN step_executions se ON se.id = s.step_execution_id
       LEFT JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       ${where}
       ORDER BY s.created_at DESC`,
      )
      .all(...params) as SessionRow[];

    return rows.map(sessionRowToDomain);
  }

  setTransitionDecision(id: string, decision: TransitionDecision): void {
    this.db
      .prepare("UPDATE sessions SET transition_decision = ? WHERE id = ?")
      .run(JSON.stringify(decision), id);
  }

  setAgentSession(
    id: string,
    agentSessionId: string | null,
    attachCommand: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET claude_session_id = ?, terminal_attach_command = ?
         WHERE id = ?`,
      )
      .run(agentSessionId, attachCommand, id);
  }

  setSessionRunning(id: string, now: string): boolean {
    return this.updateSessionStatus(
      id,
      "running",
      now,
      "status NOT IN ('success', 'failure') AND status != ?",
      ["running"],
    );
  }

  setSessionAwaitingInput(id: string, now: string): boolean {
    return this.updateSessionStatus(
      id,
      "awaiting_input",
      now,
      "status NOT IN ('success', 'failure') AND status != ?",
      ["awaiting_input"],
    );
  }

  setSessionSucceeded(
    id: string,
    now: string,
    decision?: TransitionDecision | null,
  ): boolean {
    return this.updateSessionStatus(
      id,
      "success",
      now,
      "status NOT IN ('success', 'failure')",
      [],
      decision,
    );
  }

  setSessionFailed(
    id: string,
    now: string,
    decision?: TransitionDecision | null,
  ): boolean {
    return this.updateSessionStatus(
      id,
      "failure",
      now,
      "status NOT IN ('success', 'failure')",
      [],
      decision,
    );
  }

  /**
   * Deletes all session and workflow data for the given worktree branches within
   * a single transaction. Returns the log file paths of deleted sessions so the
   * caller can clean them up from disk.
   */
  deleteWorktreeData(
    repositoryPath: string,
    branches: string[],
  ): { log_file_path: string }[] {
    if (branches.length === 0) return [];

    const placeholders = branches.map(() => "?").join(", ");
    const params = [repositoryPath, ...branches];

    const rows = this.db
      .prepare(
        `SELECT log_file_path FROM sessions WHERE repository_path = ? AND worktree_branch IN (${placeholders})`,
      )
      .all(...params) as { log_file_path: string }[];

    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM sessions WHERE repository_path = ? AND worktree_branch IN (${placeholders})`,
        )
        .run(...params);
      this.db
        .prepare(
          `DELETE FROM step_executions WHERE workflow_run_id IN (
           SELECT id FROM workflow_runs WHERE repository_path = ? AND worktree_branch IN (${placeholders})
         )`,
        )
        .run(...params);
      this.db
        .prepare(
          `DELETE FROM workflow_runs WHERE repository_path = ? AND worktree_branch IN (${placeholders})`,
        )
        .run(...params);
    })();

    return rows;
  }

  listPersistedWorktreeBranches(repositoryPath: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT worktree_branch
         FROM (
           SELECT worktree_branch
           FROM sessions
           WHERE repository_path = ?
           UNION
           SELECT worktree_branch
           FROM workflow_runs
           WHERE repository_path = ?
         )
         ORDER BY worktree_branch ASC`,
      )
      .all(repositoryPath, repositoryPath) as Array<{
      worktree_branch: string;
    }>;

    return rows.map((row) => row.worktree_branch);
  }

  recoverCrashedSessions(): void {
    const now = new Date().toISOString();
    const runningSessions = this.db
      .prepare(`SELECT id FROM sessions WHERE status = 'running'`)
      .all() as Array<{ id: string }>;

    this.db
      .prepare(
        `UPDATE sessions SET status = 'failure', updated_at = ?
       WHERE status = 'running'`,
      )
      .run(now);

    for (const { id } of runningSessions) {
      this.emitStatusChanged(id, "failure", null);
    }
  }
}
