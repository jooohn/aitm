import { env } from "process";
import { spawnAsync } from "@/backend/utils/process";

export interface CommandStateExecutionResult {
  outcome: "succeeded" | "failed";
  commandOutput: string | null;
}

export class CommandStateExecutor {
  constructor() {}

  async execute(
    command: string,
    { cwd }: { cwd: string },
  ): Promise<CommandStateExecutionResult> {
    const { code, stdout, stderr } = await spawnAsync("sh", ["-c", command], {
      cwd,
    });

    const outcome = code === 0 ? "succeeded" : "failed";
    const commandOutput = [stdout, stderr].filter(Boolean).join("\n") || null;
    return { outcome, commandOutput };
  }
}
