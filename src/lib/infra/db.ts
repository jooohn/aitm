import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const dbPath = process.env.AITM_DB_PATH ?? join(homedir(), ".aitm", "aitm.db");

if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS workflow_runs (
    id               TEXT    PRIMARY KEY,
    repository_path  TEXT    NOT NULL,
    worktree_branch  TEXT    NOT NULL,
    workflow_name    TEXT    NOT NULL,
    current_state    TEXT,
    status           TEXT    NOT NULL DEFAULT 'running',
    inputs           TEXT,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS state_executions (
    id                  TEXT    PRIMARY KEY,
    workflow_run_id     TEXT    NOT NULL REFERENCES workflow_runs(id),
    state               TEXT    NOT NULL,
    command_output      TEXT,
    transition_decision TEXT,
    handoff_summary     TEXT,
    created_at          TEXT    NOT NULL,
    completed_at        TEXT
  );

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

  CREATE TABLE IF NOT EXISTS session_messages (
    id         TEXT    PRIMARY KEY,
    session_id TEXT    NOT NULL REFERENCES sessions(id),
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  );
`);
