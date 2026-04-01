import { execFileSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGitHubUrl,
  getRepositoryByAlias,
  inferAlias,
  listRepositories,
  validateRepository,
} from "./repositories";

let configFile: string;

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
  const dir = makeTempDir();
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
});

function writeConfig(paths: string[]) {
  const lines = ["repositories:"];
  for (const p of paths) lines.push(`  - path: ${p}`);
  writeFileSync(configFile, lines.join("\n"));
}

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

describe("listRepositories", () => {
  it("returns empty array when config has no repositories", () => {
    expect(listRepositories()).toEqual([]);
  });

  it("returns repos defined in config", () => {
    const repoPath = makeFakeGitRepo();
    writeConfig([repoPath]);

    const list = listRepositories();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(repoPath);
  });

  it("includes alias and name on each repo", () => {
    const repoPath = makeFakeGitRepo();
    writeConfig([repoPath]);

    const [repo] = listRepositories();
    const parts = repoPath.split("/").filter(Boolean);
    expect(repo.alias).toBe(parts.slice(-2).join("/"));
    expect(repo.name).toBe(parts.at(-1));
  });

  it("returns repos sorted by path ascending", () => {
    const a = "/tmp/aaa/repo";
    const b = "/tmp/bbb/repo";
    writeConfig([b, a]);
    const list = listRepositories();
    expect(list.map((r) => r.path)).toEqual([a, b]);
  });
});

describe("getRepositoryByAlias", () => {
  it("returns the matching repo", () => {
    const repoPath = makeFakeGitRepo();
    writeConfig([repoPath]);
    const parts = repoPath.split("/").filter(Boolean);
    const alias = parts.slice(-2).join("/");
    expect(getRepositoryByAlias(alias)?.path).toBe(repoPath);
  });

  it("returns undefined for unknown alias", () => {
    expect(getRepositoryByAlias("no/such")).toBeUndefined();
  });
});

function makeRealGitRepo(): string {
  const dir = (() => {
    const d = join(
      tmpdir(),
      `aitm-test-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(d, { recursive: true });
    return d;
  })();
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("getGitHubUrl", () => {
  it("returns null when no remote is configured", () => {
    const dir = makeRealGitRepo();
    expect(getGitHubUrl(dir)).toBeNull();
  });

  it("returns null for a non-GitHub HTTPS remote", () => {
    const dir = makeRealGitRepo();
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://gitlab.com/org/repo.git"],
      { cwd: dir },
    );
    expect(getGitHubUrl(dir)).toBeNull();
  });

  it("parses an SSH GitHub remote (with .git suffix)", () => {
    const dir = makeRealGitRepo();
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:org/repo.git"],
      { cwd: dir },
    );
    expect(getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an SSH GitHub remote (without .git suffix)", () => {
    const dir = makeRealGitRepo();
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:org/repo"],
      { cwd: dir },
    );
    expect(getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an HTTPS GitHub remote (with .git suffix)", () => {
    const dir = makeRealGitRepo();
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/repo.git"],
      { cwd: dir },
    );
    expect(getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an HTTPS GitHub remote (without .git suffix)", () => {
    const dir = makeRealGitRepo();
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/repo"],
      { cwd: dir },
    );
    expect(getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("returns null for a non-existent path", () => {
    expect(getGitHubUrl("/nonexistent/path/that/does/not/exist")).toBeNull();
  });
});

describe("validateRepository", () => {
  it("returns valid:true for an existing git repo", () => {
    const repoPath = makeFakeGitRepo();
    expect(validateRepository(repoPath)).toEqual({ valid: true });
  });

  it("returns valid:false when the path does not exist", () => {
    const result = validateRepository("/nonexistent/path");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/does not exist/i);
  });

  it("returns valid:false when the path is not a git repo", () => {
    const dir = makeTempDir();
    const result = validateRepository(dir);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a git repository/i);
    rmSync(dir, { recursive: true });
  });
});
