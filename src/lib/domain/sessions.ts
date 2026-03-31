import { randomUUID } from "crypto";
import { mkdirSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { WorkflowTransition } from "../infra/config";
import { db } from "../infra/db";
import {
  cancelAgent,
  sendMessageToAgent,
  startAgent,
  type TransitionDecision,
} from "../utils/agent";

export type SessionStatus =
  | "RUNNING"
  | "WAITING_FOR_INPUT"
  | "SUCCEEDED"
  | "FAILED";

export interface Session {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: string; // JSON-serialized WorkflowTransition[]
  transition_decision: string | null; // JSON-serialized TransitionDecision
  status: SessionStatus;
  terminal_attach_command: string | null;
  log_file_path: string;
  claude_session_id: string | null;
  state_execution_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransition[];
  state_execution_id?: string;
}

export interface ListSessionsFilter {
  repository_path?: string;
  worktree_branch?: string;
  status?: SessionStatus;
}

function sessionsLogDir(): string {
  const dir = join(homedir(), ".aitm", "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createSession(
  input: CreateSessionInput,
  onComplete?: (decision: TransitionDecision | null) => void,
): Session {
  const id = randomUUID();
  const now = new Date().toISOString();
  const log_file_path = join(sessionsLogDir(), `${id}.log`);

  db.prepare(
    `INSERT INTO sessions
       (id, repository_path, worktree_branch, goal, transitions,
        transition_decision, status, terminal_attach_command, log_file_path,
        claude_session_id, state_execution_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.repository_path,
    input.worktree_branch,
    input.goal,
    JSON.stringify(input.transitions),
    log_file_path,
    input.state_execution_id ?? null,
    now,
    now,
  );

  startAgent(
    id,
    input.repository_path,
    input.worktree_branch,
    input.goal,
    input.transitions,
    log_file_path,
    onComplete,
  ).catch(console.error);

  return getSession(id) as Session;
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
    .prepare(`SELECT * FROM sessions ${where} ORDER BY created_at DESC`)
    .all(...params) as Session[];
}

export function getSession(id: string): Session | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | Session
    | undefined;
}

export function failSession(id: string): Session {
  const session = getSession(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  if (session.status === "SUCCEEDED" || session.status === "FAILED") {
    throw new Error(
      `Session ${id} is already in a terminal state: ${session.status}`,
    );
  }

  cancelAgent(id);

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE sessions SET status = 'FAILED', updated_at = ? WHERE id = ?",
  ).run(now, id);

  return getSession(id) as Session;
}

export interface SessionMessage {
  id: string;
  session_id: string;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

export function listMessages(sessionId: string): SessionMessage[] {
  return db
    .prepare(
      "SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as SessionMessage[];
}

export function saveMessage(
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

export function sendUserMessage(sessionId: string, content: string): void {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== "WAITING_FOR_INPUT") {
    throw new Error(
      `Session is not waiting for input (status: ${session.status})`,
    );
  }

  saveMessage(sessionId, "user", content);
  sendMessageToAgent(sessionId, content);
}

export function deleteWorktreeData(
  repositoryPath: string,
  branches: string[],
): void {
  if (branches.length === 0) return;
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

  for (const { log_file_path } of rows) {
    try {
      unlinkSync(log_file_path);
    } catch {
      // ignore missing files
    }
  }
}

// Mark any sessions left in a non-terminal state as FAILED.
// Called on module load so that sessions from a previous server run are recovered.
export function recoverCrashedSessions(): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET status = 'FAILED', updated_at = ?
     WHERE status IN ('RUNNING', 'WAITING_FOR_INPUT')`,
  ).run(now);
}
