import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendToLog } from "./log";

describe("appendToLog", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "log-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends a JSON-stringified entry with a newline", async () => {
    const logFile = join(dir, "test.log");
    await appendToLog(logFile, { msg: "hello" });
    await appendToLog(logFile, { msg: "world" });

    const content = await readFile(logFile, "utf8");
    expect(content).toBe('{"msg":"hello"}\n{"msg":"world"}\n');
  });

  it("silently ignores write errors", async () => {
    // Writing to a non-existent directory should not throw
    await expect(
      appendToLog("/no/such/dir/test.log", { x: 1 }),
    ).resolves.toBeUndefined();
  });
});
