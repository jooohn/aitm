import { describe, expect, it } from "vitest";
import { SpawnTimeoutError, spawnAsync } from "./process";

describe("spawnAsync", () => {
  it("rejects with SpawnTimeoutError when the process exceeds the timeout", async () => {
    await expect(
      spawnAsync(
        process.execPath,
        ["-e", "setTimeout(() => process.exit(0), 1000)"],
        { timeoutMs: 25 },
      ),
    ).rejects.toMatchObject({
      args: ["-e", "setTimeout(() => process.exit(0), 1000)"],
      code: "ETIMEDOUT",
      command: process.execPath,
      timeoutMs: 25,
    });
  });
});
