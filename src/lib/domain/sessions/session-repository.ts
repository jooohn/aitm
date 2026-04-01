import { randomUUID } from "crypto";
import { db } from "../../infra/db";
import type { ListSessionsFilter, Session, SessionMessage } from "./index";

export function insertSession(params: {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: string;
  log_file_path: string;
  state_execution_id: string | null;
  now: string;
}): void {
  db.prepare(
    `INSERT INTO sessions
       (id, repository_path, worktree_branch, goal, transitions,
        transition_decision, status, terminal_attach_command, log_file_path,
        claude_session_id, state_execution_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, ?, ?, ?)`,
  ).run(
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

export function getSession(id: string): Session | undefined {
  return db
    .prepare(
      `SELECT s.*, se.state AS state_name
       FROM sessions s
       LEFT JOIN state_executions se ON se.id = s.state_execution_id
       WHERE s.id = ?`,
    )
    .get(id) as Session | undefined;
}

export function listSessions(filter: ListSessionsFilter = {}): Session[] {
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
  return db
    .prepare(
      `SELECT s.*, se.state AS state_name
       FROM sessions s
       LEFT JOIN state_executions se ON se.id = s.state_execution_id
       ${where}
       ORDER BY s.created_at DESC`,
    )
    .all(...params) as Session[];
}

export function setSessionFailed(id: string, now: string): void {
  db.prepare(
    "UPDATE sessions SET status = 'FAILED', updated_at = ? WHERE id = ?",
  ).run(now, id);
}

export function listMessages(sessionId: string): SessionMessage[] {
  return db
    .prepare(
      "SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as SessionMessage[];
}

export function insertMessage(
  sessionId: string,
  role: "user" | "agent",
  content: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO session_messages (id, session_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), sessionId, role, content, now);
}

/**
 * Deletes all session and workflow data for the given worktree branches within
 * a single transaction. Returns the log file paths of deleted sessions so the
 * caller can clean them up from disk.
 */
export function deleteWorktreeData(
  repositoryPath: string,
  branches: string[],
): { log_file_path: string }[] {
  if (branches.length === 0) return [];

  const placeholders = branches.map(() => "?").join(", ");
  const params = [repositoryPath, ...branches];

  const rows = db
    .prepare(
      `SELECT log_file_path FROM sessions WHERE repository_path = ? AND worktree_branch IN (${placeholders})`,
    )
    .all(...params) as { log_file_path: string }[];

  db.transaction(() => {
    db.prepare(
      `DELETE FROM session_messages WHERE session_id IN (
         SELECT id FROM sessions WHERE repository_path = ? AND worktree_branch IN (${placeholders})
       )`,
    ).run(...params);
    db.prepare(
      `DELETE FROM sessions WHERE repository_path = ? AND worktree_branch IN (${placeholders})`,
    ).run(...params);
    db.prepare(
      `DELETE FROM state_executions WHERE workflow_run_id IN (
         SELECT id FROM workflow_runs WHERE repository_path = ? AND worktree_branch IN (${placeholders})
       )`,
    ).run(...params);
    db.prepare(
      `DELETE FROM workflow_runs WHERE repository_path = ? AND worktree_branch IN (${placeholders})`,
    ).run(...params);
  })();

  return rows;
}

export function recoverCrashedSessions(): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET status = 'FAILED', updated_at = ?
     WHERE status IN ('RUNNING', 'WAITING_FOR_INPUT')`,
  ).run(now);
}
