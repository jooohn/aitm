import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer, initializeContainer } from "@/backend/container";
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
  initializeContainer();
  vi.spyOn(getContainer().agentService, "startAgent").mockResolvedValue(
    undefined,
  );
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  getContainer(); // ensure tables exist via lazy init

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();
});

describe("GET /api/sessions", () => {
  it("returns empty array when organization/name do not match any repository", async () => {
    const repoPath = await makeFakeGitRepo();
    await setupConfig("workflows: {}\n", [repoPath]);

    // Create a session directly
    await getContainer().sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
      log_file_path: join(tmpdir(), "aitm-test-logs", `${randomUUID()}.log`),
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

    await getContainer().sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
      log_file_path: join(tmpdir(), "aitm-test-logs", `${randomUUID()}.log`),
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

  it("returns 422 for an unknown status filter", async () => {
    await setupConfig("workflows: {}\n");

    const res = await GET(
      new NextRequest("http://localhost/api/sessions?status=not-a-status"),
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringMatching(/status/i),
    });
  });

  it("uses the first status value when the query repeats the parameter", async () => {
    await setupConfig("workflows: {}\n");

    const res = await GET(
      new NextRequest(
        "http://localhost/api/sessions?status=not-a-status&status=running",
      ),
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringMatching(/status/i),
    });
  });
});
