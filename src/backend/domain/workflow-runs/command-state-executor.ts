import { spawnSync } from "child_process";

export interface CommandStateExecutionResult {
  outcome: "succeeded" | "failed";
  commandOutput: string | null;
}

export class CommandStateExecutor {
  constructor() {}

  execute(
    command: string,
    { cwd }: { cwd: string },
  ): CommandStateExecutionResult {
    const result = spawnSync("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
    });
    const outcome = result.status === 0 ? "succeeded" : "failed";
    const commandOutput =
      [result.stdout, result.stderr].filter(Boolean).join("\n") || null;
    return { outcome, commandOutput };
  }
}
