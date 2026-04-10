import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { GET, POST } from "./route";

function makeParams(
  organization: string,
  name: string,
  branch: string,
): {
  params: Promise<{ organization: string; name: string; branch: string }>;
} {
  return { params: Promise.resolve({ organization, name, branch }) };
}

let getRepositoryByAliasSpy: ReturnType<typeof vi.spyOn>;
let getCommandsForAliasSpy: ReturnType<typeof vi.spyOn>;
let listWorktreesSpy: ReturnType<typeof vi.spyOn>;
let listProcessesSpy: ReturnType<typeof vi.spyOn>;
let startProcessSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getRepositoryByAliasSpy = vi.spyOn(
    container.repositoryService,
    "getRepositoryByAlias",
  );
  getCommandsForAliasSpy = vi.spyOn(
    container.repositoryService,
    "getCommandsForAlias",
  );
  listWorktreesSpy = vi
    .spyOn(container.worktreeService, "listWorktrees")
    .mockResolvedValue([]);
  listProcessesSpy = vi.spyOn(container.processService, "listProcesses");
  startProcessSpy = vi.spyOn(container.processService, "startProcess");
});

describe("GET /api/repositories/:org/:name/worktrees/[branch]/processes", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when worktree is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([]);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(404);
  });

  it("returns list of processes using the worktree path", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([
      { branch: "feat/test", path: "/repo/worktrees/feat/test" },
    ]);
    listProcessesSpy.mockReturnValue([
      {
        id: "p1",
        worktree_branch: "feat/test",
        command_id: "nextjs-dev",
        command_label: "Dev server",
        command: "npm run dev",
        status: "running",
        pid: 1234,
        exit_code: null,
        created_at: "2026-04-10T00:00:00Z",
        stopped_at: null,
      },
    ]);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("p1");
    expect(listProcessesSpy).toHaveBeenCalledWith(
      "/repo/worktrees/feat/test",
      "feat/test",
    );
  });
});

describe("POST /api/repositories/:org/:name/worktrees/[branch]/processes", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await POST(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
        {
          method: "POST",
          body: JSON.stringify({ command_id: "nextjs-dev" }),
          headers: { "Content-Type": "application/json" },
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when worktree is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([]);

    const res = await POST(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
        {
          method: "POST",
          body: JSON.stringify({ command_id: "nextjs-dev" }),
          headers: { "Content-Type": "application/json" },
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when command_id is empty", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([
      { branch: "feat/test", path: "/repo/worktrees/feat/test" },
    ]);

    const res = await POST(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
        {
          method: "POST",
          body: JSON.stringify({ command_id: "" }),
          headers: { "Content-Type": "application/json" },
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    listWorktreesSpy.mockResolvedValue([
      { branch: "feat/test", path: "/repo/worktrees/feat/test" },
    ]);

    const res = await POST(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
        {
          method: "POST",
          body: '{"command_id":',
          headers: { "Content-Type": "application/json" },
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("returns 400 when command_id does not match any configured command", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    getCommandsForAliasSpy.mockReturnValue([
      { id: "nextjs-dev", label: "Dev server", command: "npm run dev" },
    ]);
    listWorktreesSpy.mockResolvedValue([
      { branch: "feat/test", path: "/repo/worktrees/feat/test" },
    ]);

    const res = await POST(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
        {
          method: "POST",
          body: JSON.stringify({ command_id: "unknown" }),
          headers: { "Content-Type": "application/json" },
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("starts a process by looking up command from config and returns 201", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    getCommandsForAliasSpy.mockReturnValue([
      { id: "nextjs-dev", label: "Dev server", command: "npm run dev" },
      { id: "tests", label: "Run tests", command: "npm run test:watch" },
    ]);
    listWorktreesSpy.mockResolvedValue([
      { branch: "feat/test", path: "/repo/worktrees/feat/test" },
    ]);
    startProcessSpy.mockReturnValue({
      id: "p1",
      worktree_branch: "feat/test",
      command_id: "nextjs-dev",
      command_label: "Dev server",
      command: "npm run dev",
      status: "running",
      pid: 1234,
      exit_code: null,
      created_at: "2026-04-10T00:00:00Z",
      stopped_at: null,
    });

    const res = await POST(
      new NextRequest(
        "http://localhost/api/repositories/org/repo/worktrees/feat__test/processes",
        {
          method: "POST",
          body: JSON.stringify({ command_id: "nextjs-dev" }),
          headers: { "Content-Type": "application/json" },
        },
      ),
      makeParams("org", "repo", "feat__test"),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("p1");
    expect(startProcessSpy).toHaveBeenCalledWith(
      "/repo/worktrees/feat/test",
      "feat/test",
      { id: "nextjs-dev", label: "Dev server", command: "npm run dev" },
      "org",
      "repo",
    );
  });
});
