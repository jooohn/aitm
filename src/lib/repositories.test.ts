import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  inferAlias,
  listRepositories,
  registerRepository,
  removeRepository,
  validateRepository,
} from "./repositories";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFakeGitRepo(): string {
  const dir = makeTempDir();
  mkdirSync(join(dir, ".git"));
  return dir;
}

beforeEach(() => {
  db.prepare("DELETE FROM repositories").run();
});

afterEach(() => {
  // nothing — in-memory DB is cleared in beforeEach
});

describe("inferAlias", () => {
  it("returns last two path segments joined with /", () => {
    expect(inferAlias("/some/path/jooohn/aitm")).toBe("jooohn/aitm");
  });

  it("handles paths without trailing slash", () => {
    expect(inferAlias("/home/user/github.com/org/repo")).toBe("org/repo");
  });

  it("returns single segment when path has only one component", () => {
    expect(inferAlias("/repo")).toBe("repo");
  });
});

describe("registerRepository", () => {
  it("registers a valid git repo and returns the record", () => {
    const repoPath = makeFakeGitRepo();
    const repo = registerRepository({ path: repoPath });

    expect(repo.id).toBeTypeOf("number");
    expect(repo.path).toBe(repoPath);
    expect(repo.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes alias inferred from the last two path segments", () => {
    const repoPath = makeFakeGitRepo();
    // repoPath is like /tmp/aitm-test-xxxx/org/repo structure won't apply here,
    // but we can check alias equals the last two segments of repoPath
    const repo = registerRepository({ path: repoPath });
    const parts = repoPath.split("/").filter(Boolean);
    const expectedAlias = parts.slice(-2).join("/");
    expect(repo.alias).toBe(expectedAlias);
  });

  it("rejects a path that does not exist", () => {
    expect(() =>
      registerRepository({ path: "/nonexistent/path/that/does/not/exist" }),
    ).toThrow("does not exist");
  });

  it("rejects a path that is not a git repository", () => {
    const dir = makeTempDir();
    expect(() => registerRepository({ path: dir })).toThrow(
      "not a git repository",
    );
    rmSync(dir, { recursive: true });
  });

  it("rejects a duplicate path", () => {
    const repoPath = makeFakeGitRepo();
    registerRepository({ path: repoPath });
    expect(() => registerRepository({ path: repoPath })).toThrow(
      "already registered",
    );
  });
});

describe("listRepositories", () => {
  it("returns an empty array when nothing is registered", () => {
    expect(listRepositories()).toEqual([]);
  });

  it("returns all registered repos", () => {
    const a = makeFakeGitRepo();
    const b = makeFakeGitRepo();
    registerRepository({ path: a });
    registerRepository({ path: b });

    const list = listRepositories();
    expect(list.map((r) => r.path).sort()).toEqual([a, b].sort());
  });

  it("includes alias on each listed repo", () => {
    const repoPath = makeFakeGitRepo();
    registerRepository({ path: repoPath });

    const [repo] = listRepositories();
    const parts = repoPath.split("/").filter(Boolean);
    const expectedAlias = parts.slice(-2).join("/");
    expect(repo.alias).toBe(expectedAlias);
  });
});

describe("removeRepository", () => {
  it("removes an existing repo", () => {
    const repoPath = makeFakeGitRepo();
    const { id } = registerRepository({ path: repoPath });

    removeRepository(id);
    expect(listRepositories()).toEqual([]);
  });

  it("throws when the id does not exist", () => {
    expect(() => removeRepository(9999)).toThrow("not found");
  });
});

describe("validateRepository", () => {
  it("returns valid:true for a registered repo whose path still exists", () => {
    const repoPath = makeFakeGitRepo();
    const { id } = registerRepository({ path: repoPath });

    expect(validateRepository(id)).toEqual({ valid: true });
  });

  it("returns valid:false when the path no longer exists", () => {
    const repoPath = makeFakeGitRepo();
    const { id } = registerRepository({ path: repoPath });
    rmSync(repoPath, { recursive: true });

    const result = validateRepository(id);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/does not exist/i);
  });

  it("returns valid:false when the path is no longer a git repo", () => {
    const repoPath = makeFakeGitRepo();
    const { id } = registerRepository({ path: repoPath });
    rmSync(join(repoPath, ".git"), { recursive: true });

    const result = validateRepository(id);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a git repository/i);
  });

  it("throws when the id does not exist", () => {
    expect(() => validateRepository(9999)).toThrow("not found");
  });
});
