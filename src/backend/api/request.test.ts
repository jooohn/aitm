import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as container from "@/backend/container";
import {
  parseJsonBody,
  parseSearchParams,
  resolveRepositoryFromParams,
  resolveWorktreeFromBranchSlug,
} from "./request";

describe("parseJsonBody", () => {
  it("returns typed data for a valid request body", async () => {
    const result = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_name: "my-flow" }),
      }),
      z.object({
        workflow_name: z.string().min(1, "workflow_name is required"),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ workflow_name: "my-flow" });
    }
  });

  it("returns a shared 422 response for malformed JSON", async () => {
    const result = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"workflow_name":',
      }),
      z.object({
        workflow_name: z.string().min(1, "workflow_name is required"),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(422);
      expect(await result.response.json()).toEqual({
        error: "Invalid JSON body",
      });
    }
  });

  it("returns a shared 422 response for schema validation failures", async () => {
    const result = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_name: "" }),
      }),
      z.object({
        workflow_name: z.string().min(1, "workflow_name is required"),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(422);
      expect(await result.response.json()).toEqual({
        error: "workflow_name is required",
      });
    }
  });
});

describe("resolveRepositoryFromParams", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the repository when the alias exists", async () => {
    vi.spyOn(
      container.repositoryService,
      "getRepositoryByAlias",
    ).mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });

    const result = await resolveRepositoryFromParams({
      organization: "org",
      name: "repo",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.repository.path).toBe("/repo/path");
    }
  });

  it("returns a 404 response when the repository alias does not exist", async () => {
    vi.spyOn(
      container.repositoryService,
      "getRepositoryByAlias",
    ).mockResolvedValue(undefined);

    const result = await resolveRepositoryFromParams({
      organization: "org",
      name: "repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await result.response.json()).toEqual({
        error: "Repository not found",
      });
    }
  });
});

describe("parseSearchParams", () => {
  it("keeps the first value for duplicate query parameters", () => {
    const result = parseSearchParams(
      new URLSearchParams("status=running&status=failure"),
      z.object({
        status: z.string().optional(),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ status: "running" });
    }
  });
});

describe("resolveWorktreeFromBranchSlug", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the matching worktree and branch name", async () => {
    vi.spyOn(
      container.repositoryService,
      "getRepositoryByAlias",
    ).mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    vi.spyOn(container.worktreeService, "listWorktrees").mockResolvedValue([
      {
        branch: "feat/test",
        path: "/repo/path/worktrees/feat/test",
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
    ]);

    const result = await resolveWorktreeFromBranchSlug({
      organization: "org",
      name: "repo",
      branch: "feat__test",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.worktree.path).toBe("/repo/path/worktrees/feat/test");
      expect(result.data.worktree.branch).toBe("feat/test");
      expect(result.data.repository.path).toBe("/repo/path");
    }
  });

  it("returns a 404 response when the worktree does not exist", async () => {
    vi.spyOn(
      container.repositoryService,
      "getRepositoryByAlias",
    ).mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    vi.spyOn(container.worktreeService, "listWorktrees").mockResolvedValue([]);

    const result = await resolveWorktreeFromBranchSlug({
      organization: "org",
      name: "repo",
      branch: "feat__test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await result.response.json()).toEqual({
        error: "Worktree not found",
      });
    }
  });
});
