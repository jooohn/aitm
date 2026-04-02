import { spawn } from "child_process";
import { env } from "process";

export interface CommandStateExecutionResult {
  outcome: "succeeded" | "failed";
  commandOutput: string | null;
}

export class CommandStateExecutor {
  constructor() {}

  execute(
    command: string,
    { cwd }: { cwd: string },
  ): Promise<CommandStateExecutionResult> {
    return new Promise((resolve) => {
      const child = spawn("sh", ["-c", command], {
        cwd,
        env: {
          NODE_ENV: env.NODE_ENV,
          PATH: env.PATH,
          HOME: env.HOME,
        },
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (data: Buffer) => {
        stdoutChunks.push(data.toString());
      });
      child.stderr.on("data", (data: Buffer) => {
        stderrChunks.push(data.toString());
      });

      child.on("close", (code) => {
        const outcome = code === 0 ? "succeeded" : "failed";
        const stdout = stdoutChunks.join("");
        const stderr = stderrChunks.join("");
        const commandOutput =
          [stdout, stderr].filter(Boolean).join("\n") || null;
        resolve({ outcome, commandOutput });
      });
    });
  }
}
