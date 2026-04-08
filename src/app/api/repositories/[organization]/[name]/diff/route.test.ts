import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import type { DiffFile } from "@/backend/domain/worktrees/diff";
import { GET } from "./route";

function makeParams(
  organization: string,
  name: string,
): {
  params: Promise<{ organization: string; name: string }>;
} {
  return { params: Promise.resolve({ organization, name }) };
}

let getRepositoryByAliasSpy: ReturnType<typeof vi.spyOn>;
let findWorktreeSpy: ReturnType<typeof vi.spyOn>;
let getDiffSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getRepositoryByAliasSpy = vi.spyOn(
    container.repositoryService,
    "getRepositoryByAlias",
  );
  findWorktreeSpy = vi.spyOn(container.worktreeService, "findWorktree");
  getDiffSpy = vi.spyOn(container.worktreeService, "getDiff");
});

describe("GET /api/repositories/:organization/:name/diff", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/diff?branch=feat/test",
      ),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when branch query param is missing", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });

    const res = await GET(
      new NextRequest("http://localhost/api/repositories/org/repo/diff"),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/branch/i);
  });

  it("returns 404 when worktree is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    findWorktreeSpy.mockResolvedValue(undefined);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/diff?branch=feat/test",
      ),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/worktree/i);
  });

  it("returns diff for a valid worktree branch", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    findWorktreeSpy.mockResolvedValue({
      branch: "feat/test",
      path: "/repo/worktrees/feat-test",
      is_main: false,
      is_bare: false,
      head: "abc1234",
    });

    const mockDiff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: null,
        status: "modified",
        hunks: [
          {
            header: "@@ -1,2 +1,2 @@",
            lines: [
              { type: "removed", content: "-old", oldLine: 1, newLine: null },
              { type: "added", content: "+new", oldLine: null, newLine: 1 },
              { type: "context", content: " same", oldLine: 2, newLine: 2 },
            ],
          },
        ],
      },
    ];
    getDiffSpy.mockResolvedValue(mockDiff);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/diff?branch=feat/test",
      ),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe("src/app.ts");
    expect(getDiffSpy).toHaveBeenCalledWith(
      "/repo/worktrees/feat-test",
      undefined,
    );
  });

  it("passes base query param to getDiff", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    findWorktreeSpy.mockResolvedValue({
      branch: "feat/test",
      path: "/repo/worktrees/feat-test",
      is_main: false,
      is_bare: false,
      head: "abc1234",
    });
    getDiffSpy.mockResolvedValue([]);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/diff?branch=feat/test&base=develop",
      ),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(200);
    expect(getDiffSpy).toHaveBeenCalledWith(
      "/repo/worktrees/feat-test",
      "develop",
    );
  });
});
