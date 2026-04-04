import type Database from "better-sqlite3";
import type { ListSessionsFilter, Session } from "./index";

export class SessionRepository {
  constructor(private db: Database.Database) {}

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
        status                  TEXT    NOT NULL DEFAULT 'RUNNING',
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
    transitions: string;
    agent_config: string;
    log_file_path: string;
    step_execution_id: string | null;
    metadata_fields: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, agent_config, status, terminal_attach_command, log_file_path,
          claude_session_id, step_execution_id, metadata_fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'RUNNING', NULL, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.repository_path,
        params.worktree_branch,
        params.goal,
        params.transitions,
        params.agent_config,
        params.log_file_path,
        params.step_execution_id,
        params.metadata_fields,
        params.now,
        params.now,
      );
  }

  getSession(id: string): Session | undefined {
    return this.db
      .prepare(
        `SELECT s.*, se.step AS step_name, wr.workflow_name, wr.id AS workflow_run_id
       FROM sessions s
       LEFT JOIN step_executions se ON se.id = s.step_execution_id
       LEFT JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE s.id = ?`,
      )
      .get(id) as Session | undefined;
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
    return this.db
      .prepare(
        `SELECT s.*, se.step AS step_name, wr.workflow_name, wr.id AS workflow_run_id
       FROM sessions s
       LEFT JOIN step_executions se ON se.id = s.step_execution_id
       LEFT JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       ${where}
       ORDER BY s.created_at DESC`,
      )
      .all(...params) as Session[];
  }

  setSessionFailed(id: string, now: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET status = 'FAILED', updated_at = ? WHERE id = ?",
      )
      .run(now, id);
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

  recoverCrashedSessions(): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sessions SET status = 'FAILED', updated_at = ?
       WHERE status = 'RUNNING'`,
      )
      .run(now);
  }
}
