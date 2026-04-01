import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionService } from "@/lib/container";
import { getRepositoryByAlias } from "@/lib/domain/repositories";
import { removeWorktree } from "@/lib/domain/worktrees";
import { DELETE } from "./route";

vi.mock("@/lib/domain/repositories");
vi.mock("@/lib/domain/worktrees");

function makeParams(
  organization: string,
  name: string,
  branch: string[],
): {
  params: Promise<{ organization: string; name: string; branch: string[] }>;
} {
  return { params: Promise.resolve({ organization, name, branch }) };
}

let deleteWorktreeDataSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  deleteWorktreeDataSpy = vi
    .spyOn(sessionService, "deleteWorktreeData")
    .mockImplementation(() => {});
});

describe("DELETE /api/repositories/:organization/:name/worktrees/[...branch]", () => {
  it("returns 404 when repository is not found", async () => {
    vi.mocked(getRepositoryByAlias).mockReturnValue(undefined);

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat/test",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", ["feat", "test"]),
    );

    expect(res.status).toBe(404);
    expect(vi.mocked(removeWorktree)).not.toHaveBeenCalled();
    expect(deleteWorktreeDataSpy).not.toHaveBeenCalled();
  });

  it("removes worktree and deletes worktree data", async () => {
    vi.mocked(getRepositoryByAlias).mockReturnValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat/test",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", ["feat", "test"]),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(removeWorktree)).toHaveBeenCalledWith(
      "/repo/path",
      "feat/test",
    );
    expect(deleteWorktreeDataSpy).toHaveBeenCalledWith("/repo/path", [
      "feat/test",
    ]);
  });

  it("returns 422 when trying to remove the main worktree", async () => {
    vi.mocked(getRepositoryByAlias).mockReturnValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    vi.mocked(removeWorktree).mockImplementation(() => {
      throw new Error("main is the main worktree");
    });

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/main",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", ["main"]),
    );

    expect(res.status).toBe(422);
    expect(deleteWorktreeDataSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when worktree branch is not found", async () => {
    vi.mocked(getRepositoryByAlias).mockReturnValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    vi.mocked(removeWorktree).mockImplementation(() => {
      throw new Error("Worktree not found for branch");
    });

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/nonexistent",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", ["nonexistent"]),
    );

    expect(res.status).toBe(404);
    expect(deleteWorktreeDataSpy).not.toHaveBeenCalled();
  });
});
