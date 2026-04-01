import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { SessionRepository } from "../domain/sessions/session-repository";
import { WorkflowRunRepository } from "../domain/workflow-runs/workflow-run-repository";

const dbPath = process.env.AITM_DB_PATH ?? join(homedir(), ".aitm", "aitm.db");

if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);

export const workflowRunRepository = new WorkflowRunRepository(db);
export const sessionRepository = new SessionRepository(db);

workflowRunRepository.ensureTables();
sessionRepository.ensureTables();
