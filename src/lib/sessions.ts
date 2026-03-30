import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  cancelAgent,
  sendMessageToAgent,
  startAgent,
  type TransitionDecision,
} from "./agent";
import type { WorkflowTransition } from "./config";
import { db } from "./db";

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
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransition[];
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
        claude_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.repository_path,
    input.worktree_branch,
    input.goal,
    JSON.stringify(input.transitions),
    log_file_path,
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

// Mark any sessions left in a non-terminal state as FAILED.
// Called on module load so that sessions from a previous server run are recovered.
// Uses process.env as a flag so hot-reloads in dev mode don't kill live sessions.
// (process.env is shared across all module instances in the same process,
// unlike `global` which may be sandboxed by Next.js's Turbopack module system.)
export function recoverCrashedSessions(): void {
  if (process.env.__AITM_RECOVERED) return;
  process.env.__AITM_RECOVERED = "1";

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET status = 'FAILED', updated_at = ?
     WHERE status IN ('RUNNING', 'WAITING_FOR_INPUT')`,
  ).run(now);
}
