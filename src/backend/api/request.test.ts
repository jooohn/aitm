import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getContainer } from "@/backend/container";
import { NotFoundError } from "@/backend/domain/errors";
import {
  flatMapApiResult,
  mapApiResult,
  parseJsonBody,
  parseSearchParams,
  resolveRepositoryFromParams,
  resolveWorktreeFromBranchSlug,
  tryApiResult,
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
      getContainer().repositoryService,
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
      getContainer().repositoryService,
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
      getContainer().repositoryService,
      "getRepositoryByAlias",
    ).mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    vi.spyOn(getContainer().worktreeService, "listWorktrees").mockResolvedValue(
      [
        {
          branch: "feat/test",
          path: "/repo/path/worktrees/feat/test",
          is_main: false,
          is_bare: false,
          head: "HEAD",
        },
      ],
    );

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
      getContainer().repositoryService,
      "getRepositoryByAlias",
    ).mockResolvedValue({
      path: "/repo/path",
      name: "repo",
      alias: "org/repo",
    });
    vi.spyOn(getContainer().worktreeService, "listWorktrees").mockResolvedValue(
      [],
    );

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

describe("mapApiResult", () => {
  it("transforms the data of a success result", async () => {
    const body = JSON.stringify({ value: 3 });
    const original = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
      z.object({ value: z.number() }),
    );

    const mapped = mapApiResult(original, (d) => d.value * 2);

    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.data).toBe(6);
    }
  });

  it("passes through a failure result unchanged", async () => {
    const original = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid",
      }),
      z.object({ value: z.number() }),
    );

    const mapped = mapApiResult(original, (d) => d.value * 2);

    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.response.status).toBe(422);
    }
  });
});

describe("flatMapApiResult", () => {
  it("chains two successful operations", async () => {
    const first = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 5 }),
      }),
      z.object({ value: z.number() }),
    );

    const result = await flatMapApiResult(first, async (d) => {
      const second = await parseJsonBody(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: d.value + 10 }),
        }),
        z.object({ value: z.number() }),
      );
      return second;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ value: 15 });
    }
  });

  it("short-circuits when the first result is a failure", async () => {
    const first = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid",
      }),
      z.object({ value: z.number() }),
    );

    const fn = vi.fn();
    const result = await flatMapApiResult(first, fn);

    expect(result.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns failure when the chained operation fails", async () => {
    const first = await parseJsonBody(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 5 }),
      }),
      z.object({ value: z.number() }),
    );

    const result = await flatMapApiResult(first, async () => {
      return parseJsonBody(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid",
        }),
        z.object({ value: z.number() }),
      );
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(422);
    }
  });
});

describe("tryApiResult", () => {
  it("wraps a resolved promise as success", async () => {
    const result = await tryApiResult(async () => 42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(42);
    }
  });

  it("wraps a thrown DomainError as the appropriate status", async () => {
    const result = await tryApiResult(async () => {
      throw new NotFoundError("Widget", "abc");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await result.response.json()).toEqual({
        error: "Widget not found: abc",
      });
    }
  });

  it("wraps an unknown error as 500", async () => {
    const result = await tryApiResult(async () => {
      throw new Error("boom");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      expect(await result.response.json()).toEqual({
        error: "Internal server error",
      });
    }
  });
});
