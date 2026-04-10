import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer } from "@/backend/container";
import { eventBus } from "@/backend/infra/event-bus";
import { GET, POST } from "./route";

function makeParams(
  organization: string,
  name: string,
): {
  params: Promise<{ organization: string; name: string }>;
} {
  return { params: Promise.resolve({ organization, name }) };
}

let getRepositoryByAliasSpy: ReturnType<typeof vi.spyOn>;
let listWorktreesSpy: ReturnType<typeof vi.spyOn>;
let createWorktreeSpy: ReturnType<typeof vi.spyOn>;
let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  getRepositoryByAliasSpy = vi.spyOn(
    getContainer().repositoryService,
    "getRepositoryByAlias",
  );
  listWorktreesSpy = vi.spyOn(getContainer().worktreeService, "listWorktrees");
  createWorktreeSpy = vi.spyOn(
    getContainer().worktreeService,
    "createWorktree",
  );
  emitSpy = vi.spyOn(eventBus, "emit");
});

describe("GET /api/repositories/:organization/:name/worktrees", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await GET(
      new NextRequest("http://localhost/api/repositories/org/repo/worktrees"),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(404);
    expect(listWorktreesSpy).not.toHaveBeenCalled();
  });

  it("returns worktrees for the matching repository", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([
      {
        branch: "main",
        path: "/repo/path",
        is_main: true,
        is_bare: false,
        head: "1234567",
      },
    ]);

    const res = await GET(
      new NextRequest("http://localhost/api/repositories/org/repo/worktrees"),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        branch: "main",
        path: "/repo/path",
        is_main: true,
        is_bare: false,
        head: "1234567",
      },
    ]);
    expect(listWorktreesSpy).toHaveBeenCalledWith("/repo/path");
  });
});

describe("POST /api/repositories/:organization/:name/worktrees", () => {
  it("returns 422 for malformed JSON", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });

    const res = await POST(
      new NextRequest("http://localhost/api/repositories/org/repo/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"branch":',
      }),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(createWorktreeSpy).not.toHaveBeenCalled();
  });

  it("returns 422 when branch is missing", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });

    const res = await POST(
      new NextRequest("http://localhost/api/repositories/org/repo/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: "" }),
      }),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "branch is required" });
    expect(createWorktreeSpy).not.toHaveBeenCalled();
  });

  it("creates a worktree and emits a worktree.changed event", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    createWorktreeSpy.mockResolvedValue({
      branch: "feat/test",
      path: "/repo/path/worktrees/feat/test",
      is_main: false,
      is_bare: false,
      head: "abcdef0",
    });

    const res = await POST(
      new NextRequest("http://localhost/api/repositories/org/repo/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feat/test",
          name: "Feature Worktree",
          no_fetch: true,
        }),
      }),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      branch: "feat/test",
      path: "/repo/path/worktrees/feat/test",
      is_main: false,
      is_bare: false,
      head: "abcdef0",
    });
    expect(createWorktreeSpy).toHaveBeenCalledWith("/repo/path", "feat/test", {
      name: "Feature Worktree",
      no_fetch: true,
    });
    expect(emitSpy).toHaveBeenCalledWith("worktree.changed", {
      repositoryOrganization: "org",
      repositoryName: "repo",
    });
  });

  it("treats a blank name as omitted", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    createWorktreeSpy.mockResolvedValue({
      branch: "feat/test",
      path: "/repo/path/worktrees/feat/test",
      is_main: false,
      is_bare: false,
      head: "abcdef0",
    });

    const res = await POST(
      new NextRequest("http://localhost/api/repositories/org/repo/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feat/test",
          name: "",
        }),
      }),
      makeParams("org", "repo"),
    );

    expect(res.status).toBe(201);
    expect(createWorktreeSpy).toHaveBeenCalledWith("/repo/path", "feat/test", {
      name: undefined,
      no_fetch: undefined,
    });
  });
});
