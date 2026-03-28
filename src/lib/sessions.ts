import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { db } from "./db";

export type SessionStatus =
  | "RUNNING"
  | "WAITING_FOR_INPUT"
  | "SUCCEEDED"
  | "FAILED";

export interface Session {
  id: string;
  repository_id: number;
  worktree_branch: string;
  goal: string;
  completion_condition: string;
  status: SessionStatus;
  terminal_attach_command: string | null;
  log_file_path: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  repository_id: number;
  worktree_branch: string;
  goal: string;
  completion_condition: string;
}

export interface ListSessionsFilter {
  repository_id?: number;
  worktree_branch?: string;
  status?: SessionStatus;
}

// In-memory map of session IDs to PIDs for the current server process lifetime.
// On server restart this map is empty, and recoverCrashedSessions() marks any
// leftover RUNNING/WAITING_FOR_INPUT sessions as FAILED.
const runningProcesses = new Map<string, number>();

function sessionsLogDir(): string {
  const dir = join(homedir(), ".aitm", "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createSession(input: CreateSessionInput): Session {
  const id = randomUUID();
  const now = new Date().toISOString();
  const log_file_path = join(sessionsLogDir(), `${id}.log`);

  db.prepare(
    `INSERT INTO sessions
       (id, repository_id, worktree_branch, goal, completion_condition,
        status, terminal_attach_command, log_file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'RUNNING', NULL, ?, ?, ?)`,
  ).run(
    id,
    input.repository_id,
    input.worktree_branch,
    input.goal,
    input.completion_condition,
    log_file_path,
    now,
    now,
  );

  // TODO: start Claude Code SDK agent in worktree directory

  return getSession(id) as Session;
}

export function listSessions(filter: ListSessionsFilter = {}): Session[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.repository_id !== undefined) {
    conditions.push("repository_id = ?");
    params.push(filter.repository_id);
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

  const pid = runningProcesses.get(id);
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }
    runningProcesses.delete(id);
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE sessions SET status = 'FAILED', updated_at = ? WHERE id = ?",
  ).run(now, id);

  return getSession(id) as Session;
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

recoverCrashedSessions();
