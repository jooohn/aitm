import { mkdir, writeFile } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeConfig, resetConfigForTests } from "@/backend/infra/config";
import { GET } from "./route";

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

async function writeConfig(paths: string[]) {
  const lines = paths.length === 0 ? ["repositories: []"] : ["repositories:"];
  for (const p of paths) lines.push(`  - path: ${p}`);
  await writeFile(configFile, lines.join("\n"));
  await initializeConfig();
}

function makeParams(
  organization: string,
  name: string,
): { params: Promise<{ organization: string; name: string }> } {
  return { params: Promise.resolve({ organization, name }) };
}

beforeEach(async () => {
  const dir = await makeTempDir();
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
  resetConfigForTests();
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
  resetConfigForTests();
});

describe("GET /api/repositories/:organization/:name", () => {
  it("returns 200 with the repository details", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeConfig([repoPath]);
    const parts = repoPath.split("/").filter(Boolean);
    const organization = parts[parts.length - 2];
    const name = parts[parts.length - 1];

    const res = await GET(
      new NextRequest(
        `http://localhost/api/repositories/${organization}/${name}`,
      ),
      makeParams(organization, name),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe(repoPath);
    expect(body.alias).toBe(`${organization}/${name}`);
    expect(body.name).toBe(name);
    expect(body).toHaveProperty("github_url");
  });

  it("returns 404 for unknown alias", async () => {
    await writeConfig([]);
    const res = await GET(
      new NextRequest("http://localhost/api/repositories/no/such"),
      makeParams("no", "such"),
    );
    expect(res.status).toBe(404);
  });
});
