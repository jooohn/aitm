import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { NotFoundError } from "@/backend/domain/errors";
import { DELETE, GET } from "./route";

function makeParams(
  organization: string,
  name: string,
  branch: string[],
  processId: string,
): {
  params: Promise<{
    organization: string;
    name: string;
    branch: string;
    processId: string;
  }>;
} {
  return {
    params: Promise.resolve({ organization, name, branch, processId }),
  };
}

let getRepositoryByAliasSpy: ReturnType<typeof vi.spyOn>;
let getProcessSpy: ReturnType<typeof vi.spyOn>;
let stopProcessSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getRepositoryByAliasSpy = vi.spyOn(
    container.repositoryService,
    "getRepositoryByAlias",
  );
  getProcessSpy = vi.spyOn(container.processService, "getProcess");
  stopProcessSpy = vi.spyOn(container.processService, "stopProcess");
});

describe("GET /api/repositories/:org/:name/worktrees/[branch]/processes/:processId", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await GET(
      new NextRequest("http://localhost/test"),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when process is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    getProcessSpy.mockReturnValue(undefined);

    const res = await GET(
      new NextRequest("http://localhost/test"),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns process details", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    getProcessSpy.mockReturnValue({
      id: "p1",
      worktree_branch: "feat/test",
      command: "npm run dev",
      status: "running",
      pid: 1234,
      exit_code: null,
      created_at: "2026-04-10T00:00:00Z",
      stopped_at: null,
    });

    const res = await GET(
      new NextRequest("http://localhost/test"),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("p1");
  });
});

describe("DELETE /api/repositories/:org/:name/worktrees/[branch]/processes/:processId", () => {
  it("returns 404 when repository is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue(undefined);

    const res = await DELETE(
      new NextRequest("http://localhost/test", { method: "DELETE" }),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(404);
  });

  it("stops the process and returns the result", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    stopProcessSpy.mockResolvedValue({
      id: "p1",
      worktree_branch: "feat/test",
      command: "npm run dev",
      status: "stopped",
      pid: 1234,
      exit_code: null,
      created_at: "2026-04-10T00:00:00Z",
      stopped_at: "2026-04-10T00:01:00Z",
    });

    const res = await DELETE(
      new NextRequest("http://localhost/test", { method: "DELETE" }),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("stopped");
    expect(stopProcessSpy).toHaveBeenCalledWith("p1");
  });

  it("returns 404 when process is not found", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    stopProcessSpy.mockRejectedValue(new NotFoundError("Process", "p1"));

    const res = await DELETE(
      new NextRequest("http://localhost/test", { method: "DELETE" }),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(404);
  });
});
