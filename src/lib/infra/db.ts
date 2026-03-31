import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const dbPath = process.env.AITM_DB_PATH ?? join(homedir(), ".aitm", "aitm.db");

if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);

// Migration: drop dependent tables then sessions when the schema needs updating.
// Data loss is accepted for these structural migrations.
const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as {
  name: string;
}[];
const needsSessionRebuild =
  sessionCols.length > 0 &&
  (sessionCols.some((c) => c.name === "repository_id") ||
    sessionCols.some((c) => c.name === "completion_condition"));
if (needsSessionRebuild) {
  db.exec("DROP TABLE IF EXISTS state_executions");
  db.exec("DROP TABLE IF EXISTS workflow_runs");
  db.exec("DROP TABLE IF EXISTS session_messages");
  db.exec("DROP TABLE IF EXISTS sessions");
}

// Remove legacy repositories table if present.
db.exec("DROP TABLE IF EXISTS repositories");

// Migration: add inputs column to workflow_runs if missing.
const workflowRunCols = db
  .prepare("PRAGMA table_info(workflow_runs)")
  .all() as { name: string }[];
if (
  workflowRunCols.length > 0 &&
  !workflowRunCols.some((c) => c.name === "inputs")
) {
  db.exec("ALTER TABLE workflow_runs ADD COLUMN inputs TEXT");
}

// Migration: replace session_id on state_executions and workflow_run_id on sessions
// with state_execution_id on sessions (correct child-to-parent FK direction).
// Data loss is accepted — same approach as prior structural migrations.
const seColsForMigration = db
  .prepare("PRAGMA table_info(state_executions)")
  .all() as { name: string }[];
const sessionColsForMigration = db
  .prepare("PRAGMA table_info(sessions)")
  .all() as { name: string }[];
const needsRelationshipRebuild =
  seColsForMigration.some((c) => c.name === "session_id") ||
  (sessionColsForMigration.length > 0 &&
    sessionColsForMigration.some((c) => c.name === "workflow_run_id")) ||
  (sessionColsForMigration.length > 0 &&
    !sessionColsForMigration.some((c) => c.name === "state_execution_id"));
if (needsRelationshipRebuild) {
  db.exec("DROP TABLE IF EXISTS session_messages");
  db.exec("DROP TABLE IF EXISTS state_executions");
  db.exec("DROP TABLE IF EXISTS sessions");
}

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
