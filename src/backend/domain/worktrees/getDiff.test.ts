import { beforeEach, describe, expect, it, vi } from "vitest";
import * as processUtils from "@/backend/utils/process";
import { WorktreeService } from "./index";

describe("WorktreeService.getDiff", () => {
  let service: WorktreeService;

  beforeEach(() => {
    service = new WorktreeService();
  });

  it("runs git diff with default base ref and returns parsed files", async () => {
    const diffOutput = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index abc1234..def5678 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,2 @@",
      "-const x = 1;",
      "+const x = 2;",
      " export default x;",
    ].join("\n");

    const spawnSpy = vi
      .spyOn(processUtils, "spawnAsync")
      .mockResolvedValue({ code: 0, stdout: diffOutput, stderr: "" });

    const result = await service.getDiff("/worktree/path");

    expect(spawnSpy).toHaveBeenCalledWith("git", ["diff", "main...HEAD"], {
      cwd: "/worktree/path",
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/app.ts");
  });

  it("uses custom base ref when provided", async () => {
    const spawnSpy = vi
      .spyOn(processUtils, "spawnAsync")
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await service.getDiff("/worktree/path", "develop");

    expect(spawnSpy).toHaveBeenCalledWith("git", ["diff", "develop...HEAD"], {
      cwd: "/worktree/path",
    });
  });

  it("returns empty array when there are no changes", async () => {
    vi.spyOn(processUtils, "spawnAsync").mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });

    const result = await service.getDiff("/worktree/path");
    expect(result).toEqual([]);
  });

  it("throws when git diff fails", async () => {
    vi.spyOn(processUtils, "spawnAsync").mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "fatal: bad revision 'main...HEAD'",
    });

    await expect(service.getDiff("/worktree/path")).rejects.toThrow(
      "fatal: bad revision",
    );
  });
});
