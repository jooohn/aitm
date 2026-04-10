import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer, initializeContainer } from "@/backend/container";
import { db } from "@/backend/infra/db";
import { inferAlias } from "@/lib/utils/inferAlias";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { GET, POST } from "./route";

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

let configFile: string;

async function setupConfig(repoPaths: string[] = []) {
  const repoLines = repoPaths.map((path) => `  - path: "${path}"`).join("\n");
  const fullContent = repoLines
    ? `repositories:\n${repoLines}\n`
    : "repositories: []\n";
  await writeTestConfig(configFile, fullContent);
  initializeContainer();
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  getContainer(); // ensure tables exist via lazy init
  db.prepare("DELETE FROM chat_proposals").run();
  db.prepare("DELETE FROM chats").run();
  vi.restoreAllMocks();
});

describe("POST /api/chats", () => {
  it("creates a chat for the matching repository", async () => {
    const repoPath = await makeFakeGitRepo();
    const [organization, name] = inferAlias(repoPath).split("/");
    await setupConfig([repoPath]);

    const res = await POST(
      new NextRequest("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization, name }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.organization).toBe(organization);
    expect(body.name).toBe(name);
    expect(body).not.toHaveProperty("repository_path");
  });

  it("returns 422 for malformed JSON", async () => {
    await setupConfig();

    const res = await POST(
      new NextRequest("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"organization":',
      }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("returns 422 when organization or name is missing", async () => {
    await setupConfig();

    const res = await POST(
      new NextRequest("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization: "org" }),
      }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "organization and name are required",
    });
  });

  it("returns 404 when repository is not found", async () => {
    await setupConfig();

    const res = await POST(
      new NextRequest("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization: "org", name: "repo" }),
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Repository org/repo not found",
    });
  });
});

describe("GET /api/chats", () => {
  it("returns an empty array when the repository filter does not match any repository", async () => {
    const repoPath = await makeFakeGitRepo();
    const [organization, name] = inferAlias(repoPath).split("/");
    await setupConfig([repoPath]);

    await POST(
      new NextRequest("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization, name }),
      }),
    );

    const res = await GET(
      new NextRequest(
        "http://localhost/api/chats?organization=missing&name=repo",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
