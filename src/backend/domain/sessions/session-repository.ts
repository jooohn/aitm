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
        status                  TEXT    NOT NULL DEFAULT 'RUNNING',
        terminal_attach_command TEXT,
        log_file_path           TEXT    NOT NULL,
        claude_session_id       TEXT,
        state_execution_id      TEXT    REFERENCES state_executions(id),
        created_at              TEXT    NOT NULL,
        updated_at              TEXT    NOT NULL
      );
    `);
  }

  insertSession(params: {
    id: string;
    repository_path: string;
    worktree_branch: string;
    goal: string;
    transitions: string;
    log_file_path: string;
    state_execution_id: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, status, terminal_attach_command, log_file_path,
          claude_session_id, state_execution_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.repository_path,
        params.worktree_branch,
        params.goal,
        params.transitions,
        params.log_file_path,
        params.state_execution_id,
        params.now,
        params.now,
      );
  }

  getSession(id: string): Session | undefined {
    return this.db
      .prepare(
        `SELECT s.*, se.state AS state_name
       FROM sessions s
       LEFT JOIN state_executions se ON se.id = s.state_execution_id
       WHERE s.id = ?`,
      )
      .get(id) as Session | undefined;
  }

  listSessions(filter: ListSessionsFilter = {}): Session[] {
    const conditions: string[] = [];
    const params: string[] = [];

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
      .prepare(
        `SELECT s.*, se.state AS state_name
       FROM sessions s
       LEFT JOIN state_executions se ON se.id = s.state_execution_id
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
          `DELETE FROM state_executions WHERE workflow_run_id IN (
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
       WHERE status IN ('RUNNING', 'AWAITING_INPUT')`,
      )
      .run(now);
  }
}
