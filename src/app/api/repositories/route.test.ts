import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

let configFile: string;

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
});

describe("GET /api/repositories", () => {
  it("returns 200 with an empty array when config has no repositories", async () => {
    writeFileSync(configFile, "");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns repos defined in config", async () => {
    const repoPath = makeFakeGitRepo();
    writeFileSync(configFile, `repositories:\n  - path: ${repoPath}\n`);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].path).toBe(repoPath);
  });
});
