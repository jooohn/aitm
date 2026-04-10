import { sanitizeChildEnv, spawnAsync } from "@/backend/utils/process";

export interface CommandStepExecutionResult {
  outcome: "succeeded" | "failed";
  commandOutput: string | null;
}

export class CommandStepExecutor {
  constructor() {}

  async execute(
    command: string,
    { cwd }: { cwd: string },
  ): Promise<CommandStepExecutionResult> {
    const { code, stdout, stderr } = await spawnAsync("sh", ["-c", command], {
      cwd,
      env: sanitizeChildEnv(),
    });

    const outcome = code === 0 ? "succeeded" : "failed";
    const commandOutput = [stdout, stderr].filter(Boolean).join("\n") || null;
    return { outcome, commandOutput };
  }
}
