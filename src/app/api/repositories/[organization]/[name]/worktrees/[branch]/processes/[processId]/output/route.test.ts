import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { GET } from "./route";

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
let getOutputSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getRepositoryByAliasSpy = vi.spyOn(
    container.repositoryService,
    "getRepositoryByAlias",
  );
  getProcessSpy = vi.spyOn(container.processService, "getProcess");
  getOutputSpy = vi.spyOn(container.processService, "getOutput");
});

describe("GET /api/repositories/:org/:name/worktrees/[branch]/processes/:processId/output", () => {
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

  it("returns an SSE stream with text/event-stream content type", async () => {
    getRepositoryByAliasSpy.mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    getProcessSpy.mockReturnValue({
      id: "p1",
      status: "stopped",
    });
    getOutputSpy.mockReturnValue(["line1", "line2"]);

    const res = await GET(
      new NextRequest("http://localhost/test"),
      makeParams("org", "repo", "feat__test", "p1"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain("data:");
    expect(text).toContain("line1");

    await reader.cancel();
  });
});
