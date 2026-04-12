export type CommandExecutionStatus = "running" | "success" | "failure";

export interface CommandExecution {
  id: string;
  step_execution_id: string;
  command: string;
  cwd: string;
  status: CommandExecutionStatus;
  exit_code: number | null;
  output_file_path: string | null;
  created_at: string;
  completed_at: string | null;
}
