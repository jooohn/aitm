import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer, processService } from "@/backend/container";
import { NotFoundError, ValidationError } from "@/backend/domain/errors";
import { DELETE } from "./route";

function makeParams(
  organization: string,
  name: string,
  branch: string,
): {
  params: Promise<{ organization: string; name: string; branch: string }>;
} {
  return { params: Promise.resolve({ organization, name, branch }) };
}

let deleteWorktreeDataSpy: ReturnType<typeof vi.spyOn>;
let removeWorktreeSpy: ReturnType<typeof vi.spyOn>;
let listWorktreesSpy: ReturnType<typeof vi.spyOn>;
let stopAllForWorktreeSpy: ReturnType<typeof vi.spyOn>;
let getRepositoryByAliasSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  deleteWorktreeDataSpy = vi
    .spyOn(getContainer().sessionService, "deleteWorktreeData")
    .mockResolvedValue();
  removeWorktreeSpy = vi
    .spyOn(getContainer().worktreeService, "removeWorktree")
    .mockResolvedValue();
  listWorktreesSpy = vi
    .spyOn(getContainer().worktreeService, "listWorktrees")
    .mockResolvedValue([]);
  stopAllForWorktreeSpy = vi
    .spyOn(processService, "stopAllForWorktree")
    .mockResolvedValue();
  getRepositoryByAliasSpy = vi.spyOn(
    getContainer().repositoryService,
    "getRepositoryByAlias",
  );
});

describe("DELETE /api/repositories/:organization/:name/worktrees/[branch]", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(404);
    expect(removeWorktreeSpy).not.toHaveBeenCalled();
    expect(deleteWorktreeDataSpy).not.toHaveBeenCalled();
  });

  it("removes worktree and deletes worktree data", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([
      { branch: "feat/test", path: "/repo/path/worktrees/feat/test" },
    ]);

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(200);
    expect(removeWorktreeSpy).toHaveBeenCalledWith("/repo/path", "feat/test");
    expect(deleteWorktreeDataSpy).toHaveBeenCalledWith("/repo/path", [
      "feat/test",
    ]);
    expect(stopAllForWorktreeSpy).toHaveBeenCalledWith(
      "/repo/path/worktrees/feat/test",
      "feat/test",
    );
  });

  it("returns 422 when trying to remove the main worktree", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([
      { branch: "main", path: "/repo/path" },
    ]);
    removeWorktreeSpy.mockRejectedValue(
      new ValidationError("main is the main worktree"),
    );

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/main",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", "main"),
    );

    expect(res.status).toBe(422);
    expect(deleteWorktreeDataSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when worktree branch is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([]);

    const res = await DELETE(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/nonexistent",
        {
          method: "DELETE",
        },
      ),
      makeParams("org", "repo", "nonexistent"),
    );

    expect(res.status).toBe(404);
    expect(removeWorktreeSpy).not.toHaveBeenCalled();
    expect(deleteWorktreeDataSpy).not.toHaveBeenCalled();
  });
});
