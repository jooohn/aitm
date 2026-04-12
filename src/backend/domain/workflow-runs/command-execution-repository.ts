import type Database from "better-sqlite3";
import type {
  CommandExecution,
  CommandExecutionStatus,
} from "./command-execution";

export class CommandExecutionRepository {
  constructor(private db: Database.Database) {}

  ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_executions (
        id                TEXT PRIMARY KEY,
        step_execution_id TEXT NOT NULL REFERENCES step_executions(id),
        command           TEXT NOT NULL,
        cwd               TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'running',
        exit_code         INTEGER,
        output_file_path  TEXT,
        created_at        TEXT NOT NULL,
        completed_at      TEXT
      );
    `);
  }

  insertCommandExecution(params: {
    id: string;
    step_execution_id: string;
    command: string;
    cwd: string;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO command_executions
         (id, step_execution_id, command, cwd, status, exit_code, output_file_path, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'running', NULL, NULL, ?, NULL)`,
      )
      .run(
        params.id,
        params.step_execution_id,
        params.command,
        params.cwd,
        params.now,
      );
  }

  completeCommandExecution(params: {
    id: string;
    status: CommandExecutionStatus;
    exit_code: number | null;
    output_file_path: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `UPDATE command_executions
         SET status = ?, exit_code = ?, output_file_path = ?, completed_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        params.status,
        params.exit_code,
        params.output_file_path,
        params.now,
        params.id,
      );
  }

  getCommandExecution(id: string): CommandExecution | undefined {
    return this.db
      .prepare("SELECT * FROM command_executions WHERE id = ?")
      .get(id) as CommandExecution | undefined;
  }

  getCommandExecutionByStepExecutionId(
    stepExecutionId: string,
  ): CommandExecution | undefined {
    return this.db
      .prepare("SELECT * FROM command_executions WHERE step_execution_id = ?")
      .get(stepExecutionId) as CommandExecution | undefined;
  }

  failRunningCommandExecutions(now: string): void {
    this.db
      .prepare(
        `UPDATE command_executions
         SET status = 'failure', completed_at = ?
         WHERE status = 'running'`,
      )
      .run(now);
  }
}
