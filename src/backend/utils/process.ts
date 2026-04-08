import { spawn } from "child_process";

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class SpawnTimeoutError extends Error {
  code = "ETIMEDOUT" as const;

  constructor(
    public command: string,
    public args: string[],
    public timeoutMs: number,
  ) {
    super(
      `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
    );
    this.name = "SpawnTimeoutError";
  }
}

export function spawnAsync(
  command: string,
  args: string[],
  options?: SpawnOptions,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let timeoutError: SpawnTimeoutError | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timeoutId =
      options?.timeoutMs == null
        ? undefined
        : setTimeout(() => {
            timeoutError = new SpawnTimeoutError(
              command,
              args,
              options.timeoutMs!,
            );
            child.kill("SIGTERM");

            forceKillTimer = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                child.kill("SIGKILL");
              }
            }, 100);
          }, options.timeoutMs);

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      callback();
    };

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (error) => finish(() => reject(error)));

    child.on("close", (code) => {
      finish(() => {
        if (timeoutError) {
          reject(timeoutError);
          return;
        }

        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
        });
      });
    });
  });
}
