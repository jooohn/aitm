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
  CREATE TABLE IF NOT EXISTS repositories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    main_branch TEXT    NOT NULL,
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id                      TEXT    PRIMARY KEY,
    repository_id           INTEGER NOT NULL REFERENCES repositories(id),
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
`);

// Migration: add claude_session_id to existing sessions tables that lack it.
// CREATE TABLE IF NOT EXISTS won't recreate an existing table, so ALTER TABLE
// is needed for databases created before this column was added.
try {
  db.exec("ALTER TABLE sessions ADD COLUMN claude_session_id TEXT");
} catch {
  // Column already exists — safe to ignore.
}
