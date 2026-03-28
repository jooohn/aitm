import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const dbPath = process.env.AITM_DB_PATH ?? join(homedir(), ".aitm", "aitm.db");

if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);

// Migration: if sessions still uses the old repository_id FK (pre-config era),
// drop and recreate sessions and session_messages. Data loss is accepted —
// sessions from the old schema cannot be migrated without the repositories table.
const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as {
  name: string;
}[];
if (
  sessionCols.length > 0 &&
  sessionCols.some((c) => c.name === "repository_id")
) {
  db.exec("DROP TABLE IF EXISTS session_messages");
  db.exec("DROP TABLE IF EXISTS sessions");
}

// Remove legacy repositories table if present.
db.exec("DROP TABLE IF EXISTS repositories");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                      TEXT    PRIMARY KEY,
    repository_path         TEXT    NOT NULL,
    worktree_branch         TEXT    NOT NULL,
    goal                    TEXT    NOT NULL,
    completion_condition    TEXT    NOT NULL,
    status                  TEXT    NOT NULL DEFAULT 'RUNNING',
    terminal_attach_command TEXT,
    log_file_path           TEXT    NOT NULL,
    claude_session_id       TEXT,
    created_at              TEXT    NOT NULL,
    updated_at              TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_messages (
    id         TEXT    PRIMARY KEY,
    session_id TEXT    NOT NULL REFERENCES sessions(id),
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id               TEXT    PRIMARY KEY,
    repository_path  TEXT    NOT NULL,
    worktree_branch  TEXT    NOT NULL,
    workflow_name    TEXT    NOT NULL,
    current_state    TEXT,
    status           TEXT    NOT NULL DEFAULT 'running',
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS state_executions (
    id                  TEXT    PRIMARY KEY,
    workflow_run_id     TEXT    NOT NULL REFERENCES workflow_runs(id),
    state               TEXT    NOT NULL,
    session_id          TEXT    NOT NULL REFERENCES sessions(id),
    transition_decision TEXT,
    handoff_summary     TEXT,
    created_at          TEXT    NOT NULL,
    completed_at        TEXT
  );
`);
