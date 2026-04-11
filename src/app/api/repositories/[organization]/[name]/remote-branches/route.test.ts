import { execSync } from "child_process";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeContainer } from "@/backend/container";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { GET } from "./route";

let configFile: string;

const mockFetch = vi.fn();

function makeFakeGitRepoWithRemote(remoteUrl: string): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  execSync(`git init "${dir}"`);
  execSync(`git -C "${dir}" remote add origin "${remoteUrl}"`);
  return dir;
}

function makeParams(
  organization: string,
  name: string,
): { params: Promise<{ organization: string; name: string }> } {
  return { params: Promise.resolve({ organization, name }) };
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  vi.stubGlobal("fetch", mockFetch);
  process.env.GITHUB_TOKEN = "ghp_test123";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

async function writeConfig(paths: string[]) {
  const lines = paths.length === 0 ? ["repositories: []"] : ["repositories:"];
  for (const p of paths) lines.push(`  - path: ${p}`);
  await writeTestConfig(configFile, lines.join("\n"));
  initializeContainer();
}

describe("GET /api/repositories/:organization/:name/remote-branches", () => {
  it("returns 404 for unknown repository", async () => {
    await writeConfig([]);
    const res = await GET(
      new NextRequest(
        "http://localhost/api/repositories/no/such/remote-branches",
      ),
      makeParams("no", "such"),
    );
    expect(res.status).toBe(404);
  });

  it("returns remote branches with open PRs", async () => {
    const repoPath = makeFakeGitRepoWithRemote(
      "git@github.com:testorg/testrepo.git",
    );
    await writeConfig([repoPath]);
    const parts = repoPath.split("/").filter(Boolean);
    const organization = parts[parts.length - 2];
    const name = parts[parts.length - 1];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          number: 10,
          title: "Add feature X",
          head: { ref: "feature/x" },
        },
      ],
    });

    const res = await GET(
      new NextRequest(
        `http://localhost/api/repositories/${organization}/${name}/remote-branches`,
      ),
      makeParams(organization, name),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        branch: "feature/x",
        pr_number: 10,
        pr_title: "Add feature X",
      },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/testorg/testrepo/pulls?state=open&per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_test123",
        }),
      }),
    );
  });

  it("returns error when repository has no GitHub URL", async () => {
    const repoPath = makeFakeGitRepoWithRemote(
      "git@gitlab.com:testorg/testrepo.git",
    );
    await writeConfig([repoPath]);
    const parts = repoPath.split("/").filter(Boolean);
    const organization = parts[parts.length - 2];
    const name = parts[parts.length - 1];

    const res = await GET(
      new NextRequest(
        `http://localhost/api/repositories/${organization}/${name}/remote-branches`,
      ),
      makeParams(organization, name),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
