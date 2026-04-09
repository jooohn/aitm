import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { db } from "@/backend/infra/db";
import { inferAlias } from "@/lib/utils/inferAlias";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { GET } from "./route";

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

let configFile: string;

async function setupConfig(content: string, repoPaths: string[] = []) {
  const repoLines = repoPaths.map((p) => `  - path: "${p}"`).join("\n");
  const fullContent = repoLines
    ? `repositories:\n${repoLines}\n${content}`
    : content;
  await writeTestConfig(configFile, fullContent);
  container.initializeContainer();
  vi.spyOn(container.agentService, "startAgent").mockResolvedValue(undefined);
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();
});

describe("GET /api/sessions", () => {
  it("returns empty array when organization/name do not match any repository", async () => {
    const repoPath = await makeFakeGitRepo();
    await setupConfig("workflows: {}\n", [repoPath]);

    // Create a session directly
    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });

    // Query with non-existent org/name should return empty, not all sessions
    const res = await GET(
      new NextRequest(
        "http://localhost/api/sessions?organization=nonexistent&name=repo",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it("filters by organization/name", async () => {
    const repoPath = await makeFakeGitRepo();
    const alias = inferAlias(repoPath);
    const [organization, name] = alias.split("/");
    await setupConfig("workflows: {}\n", [repoPath]);

    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });

    const res = await GET(
      new NextRequest(
        `http://localhost/api/sessions?organization=${organization}&name=${name}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].organization).toBe(organization);
    expect(body[0].name).toBe(name);
  });
});
