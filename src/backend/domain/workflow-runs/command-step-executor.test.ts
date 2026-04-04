import { describe, expect, it } from "vitest";
import { CommandStepExecutor } from "./command-step-executor";

describe("CommandStepExecutor", () => {
  const executor = new CommandStepExecutor();

  it("returns succeeded when command exits with 0", async () => {
    const result = await executor.execute("echo hello", { cwd: "/tmp" });
    expect(result.outcome).toBe("succeeded");
    expect(result.commandOutput).toContain("hello");
  });

  it("returns failed when command exits with non-zero", async () => {
    const result = await executor.execute("exit 1", { cwd: "/tmp" });
    expect(result.outcome).toBe("failed");
  });

  it("captures stderr in commandOutput", async () => {
    const result = await executor.execute("echo err >&2", { cwd: "/tmp" });
    expect(result.commandOutput).toContain("err");
  });

  it("captures both stdout and stderr", async () => {
    const result = await executor.execute("echo out && echo err >&2", {
      cwd: "/tmp",
    });
    expect(result.commandOutput).toContain("out");
    expect(result.commandOutput).toContain("err");
  });

  it("returns null commandOutput when command produces no output", async () => {
    const result = await executor.execute("true", { cwd: "/tmp" });
    expect(result.commandOutput).toBeNull();
  });

  it("uses the specified cwd", async () => {
    const result = await executor.execute("pwd", { cwd: "/tmp" });
    expect(result.commandOutput).toMatch(/\/tmp|\/private\/tmp/);
  });

  it("does not block the event loop", async () => {
    // Start a slow command and verify setTimeout fires while it runs
    const promise = executor.execute("sleep 0.2 && echo done", { cwd: "/tmp" });

    // If execute were synchronous (spawnSync), this setTimeout callback
    // would not run until after spawnSync returns — meaning timerFiredAt
    // would be >= commandFinishedAt.
    let timerFiredAt = 0;
    const timerPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFiredAt = Date.now();
        resolve();
      }, 50);
    });

    const result = await promise;
    const commandFinishedAt = Date.now();

    await timerPromise;

    // Timer should have fired well before the command finished
    expect(timerFiredAt).toBeLessThan(commandFinishedAt);
    expect(result.outcome).toBe("succeeded");
    expect(result.commandOutput).toContain("done");
  });
});
