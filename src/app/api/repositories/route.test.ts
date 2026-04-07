import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeConfig } from "@/backend/infra/config";
import { setupTestConfigDir } from "@/test-config-helper";
import { GET } from "./route";

let configFile: string;

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();
});

describe("GET /api/repositories", () => {
  it("returns 200 with an empty array when config has no repositories", async () => {
    await writeFile(configFile, "workflows: {}\n");
    await initializeConfig();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns repos defined in config", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeFile(configFile, `repositories:\n  - path: ${repoPath}\n`);
    await initializeConfig();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].path).toBe(repoPath);
  });
});
