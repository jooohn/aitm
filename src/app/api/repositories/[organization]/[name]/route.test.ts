import { mkdirSync, writeFileSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

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

function writeConfig(paths: string[]) {
  const lines = ["repositories:"];
  for (const p of paths) lines.push(`  - path: ${p}`);
  writeFileSync(configFile, lines.join("\n"));
}

function makeParams(
  organization: string,
  name: string,
): { params: Promise<{ organization: string; name: string }> } {
  return { params: Promise.resolve({ organization, name }) };
}

beforeEach(() => {
  const dir = makeTempDir();
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
});

describe("GET /api/repositories/:organization/:name", () => {
  it("returns 200 with the repository details", async () => {
    const repoPath = makeFakeGitRepo();
    writeConfig([repoPath]);
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
    writeConfig([]);
    const res = await GET(
      new NextRequest("http://localhost/api/repositories/no/such"),
      makeParams("no", "such"),
    );
    expect(res.status).toBe(404);
  });
});
