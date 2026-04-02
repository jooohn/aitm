import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repositoryService } from "@/backend/container";
import { spawnAsync } from "@/backend/utils/process";
import { inferAlias } from "./index";

const listRepositories =
  repositoryService.listRepositories.bind(repositoryService);
const getRepositoryByAlias =
  repositoryService.getRepositoryByAlias.bind(repositoryService);
const getGitHubUrl = repositoryService.getGitHubUrl.bind(repositoryService);
const validateRepository =
  repositoryService.validateRepository.bind(repositoryService);

let configFile: string;

async function makeTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function makeFakeGitRepo(): Promise<string> {
  const dir = await makeTempDir();
  await mkdir(join(dir, ".git"));
  return dir;
}

beforeEach(async () => {
  const dir = await makeTempDir();
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
});

async function writeConfig(paths: string[]) {
  const lines = ["repositories:"];
  for (const p of paths) lines.push(`  - path: ${p}`);
  await writeFile(configFile, lines.join("\n"));
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
  it("returns empty array when config has no repositories", async () => {
    expect(await listRepositories()).toEqual([]);
  });

  it("returns repos defined in config", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeConfig([repoPath]);

    const list = await listRepositories();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(repoPath);
  });

  it("includes alias and name on each repo", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeConfig([repoPath]);

    const [repo] = await listRepositories();
    const parts = repoPath.split("/").filter(Boolean);
    expect(repo.alias).toBe(parts.slice(-2).join("/"));
    expect(repo.name).toBe(parts.at(-1));
  });

  it("returns repos sorted by path ascending", async () => {
    const a = "/tmp/aaa/repo";
    const b = "/tmp/bbb/repo";
    await writeConfig([b, a]);
    const list = await listRepositories();
    expect(list.map((r) => r.path)).toEqual([a, b]);
  });
});

describe("getRepositoryByAlias", () => {
  it("returns the matching repo", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeConfig([repoPath]);
    const parts = repoPath.split("/").filter(Boolean);
    const alias = parts.slice(-2).join("/");
    expect((await getRepositoryByAlias(alias))?.path).toBe(repoPath);
  });

  it("returns undefined for unknown alias", async () => {
    expect(await getRepositoryByAlias("no/such")).toBeUndefined();
  });
});

async function makeRealGitRepo(): Promise<string> {
  const dir = await makeTempDir();
  await spawnAsync("git", ["init"], { cwd: dir });
  await spawnAsync("git", ["config", "user.email", "test@test.com"], {
    cwd: dir,
  });
  await spawnAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# test");
  await spawnAsync("git", ["add", "."], { cwd: dir });
  await spawnAsync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("getGitHubUrl", () => {
  it("returns null when no remote is configured", async () => {
    const dir = await makeRealGitRepo();
    expect(await getGitHubUrl(dir)).toBeNull();
  });

  it("returns null for a non-GitHub HTTPS remote", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "https://gitlab.com/org/repo.git"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBeNull();
  });

  it("parses an SSH GitHub remote (with .git suffix)", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "git@github.com:org/repo.git"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an SSH GitHub remote (without .git suffix)", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "git@github.com:org/repo"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an HTTPS GitHub remote (with .git suffix)", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/repo.git"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an HTTPS GitHub remote (without .git suffix)", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/repo"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an ssh:// GitHub remote (with .git suffix)", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "ssh://git@github.com/org/repo.git"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an ssh:// GitHub remote (without .git suffix)", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "ssh://git@github.com/org/repo"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("parses an HTTPS GitHub remote with embedded credentials", async () => {
    const dir = await makeRealGitRepo();
    await spawnAsync(
      "git",
      ["remote", "add", "origin", "https://user:token@github.com/org/repo.git"],
      { cwd: dir },
    );
    expect(await getGitHubUrl(dir)).toBe("https://github.com/org/repo");
  });

  it("returns null for a non-existent path", async () => {
    expect(
      await getGitHubUrl("/nonexistent/path/that/does/not/exist"),
    ).toBeNull();
  });
});

describe("validateRepository", () => {
  it("returns valid:true for an existing git repo", async () => {
    const repoPath = await makeFakeGitRepo();
    expect(await validateRepository(repoPath)).toEqual({ valid: true });
  });

  it("returns valid:false when the path does not exist", async () => {
    const result = await validateRepository("/nonexistent/path");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/does not exist/i);
  });

  it("returns valid:false when the path is not a git repo", async () => {
    const dir = await makeTempDir();
    const result = await validateRepository(dir);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a git repository/i);
    await rm(dir, { recursive: true });
  });
});
