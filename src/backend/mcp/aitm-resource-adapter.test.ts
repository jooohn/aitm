import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer, initializeContainer } from "@/backend/container";
import { db } from "@/backend/infra/db";
import { splitAlias } from "@/lib/utils/inferAlias";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { AitmMcpResourceAdapter } from "./aitm-resource-adapter";

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

let configFile: string;
let repoPath: string;
let worktreePath: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  repoPath = await makeFakeGitRepo();
  worktreePath = await makeFakeGitRepo();

  await writeTestConfig(
    configFile,
    `
repositories:
  - path: ${repoPath}
workflows:
  review-flow:
    label: Review Flow
    initial_step: plan
    artifacts:
      plan:
        path: plan.md
        description: Shared working plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
  );
  initializeContainer();

  db.prepare("DELETE FROM chat_proposals").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  vi.spyOn(getContainer().agentService, "startAgent").mockResolvedValue(
    undefined,
  );
  vi.spyOn(getContainer().worktreeService, "listWorktrees").mockImplementation(
    async () => [
      {
        branch: "feat/test",
        path: worktreePath,
        is_main: false,
        is_bare: false,
        head: "abcdef0",
      },
    ],
  );
});

describe("AitmMcpResourceAdapter", () => {
  it("lists high-value aitm resources with stable URIs", async () => {
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "review-flow",
    });
    await getContainer().chatService.createChat(repoPath);

    const artifactDir = join(
      worktreePath,
      ".aitm",
      "runs",
      run.id,
      "artifacts",
    );
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "plan.md"), "# Plan\n");

    const adapter = new AitmMcpResourceAdapter(getContainer());
    const uris = (await adapter.listResources()).map(
      (resource) => resource.uri,
    );
    const { organization, name } = splitAlias(repoPath);

    expect(uris).toContain("aitm://config/snapshot");
    expect(uris).toContain("aitm://repositories");
    expect(uris).toContain(
      `aitm://repositories/${organization}/${name}/worktrees`,
    );
    expect(uris).toContain("aitm://workflows");
    expect(uris).toContain("aitm://workflows/review-flow");
    expect(uris).toContain("aitm://workflow-runs");
    expect(uris).toContain(`aitm://workflow-runs/${run.id}`);
    expect(uris).toContain(`aitm://workflow-runs/${run.id}/artifacts`);
    expect(uris).toContain(`aitm://workflow-runs/${run.id}/artifacts/plan.md`);
    expect(uris).toContain("aitm://sessions");
    expect(uris.some((uri) => uri.startsWith("aitm://sessions/"))).toBe(true);
    expect(uris).toContain("aitm://chats");
    expect(uris.some((uri) => uri.startsWith("aitm://chats/"))).toBe(true);
  });

  it("reads JSON and artifact resources through the shared adapter", async () => {
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "review-flow",
    });

    const artifactDir = join(
      worktreePath,
      ".aitm",
      "runs",
      run.id,
      "artifacts",
    );
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "plan.md"), "# MCP Plan\n");

    const adapter = new AitmMcpResourceAdapter(getContainer());

    const workflows = await adapter.readResource("aitm://workflows");
    expect(workflows.contents[0]).toMatchObject({
      uri: "aitm://workflows",
      mimeType: "application/json",
    });
    expect(
      "text" in workflows.contents[0] && workflows.contents[0].text,
    ).toContain('"review-flow"');

    const artifact = await adapter.readResource(
      `aitm://workflow-runs/${run.id}/artifacts/plan.md`,
    );
    expect(artifact.contents[0]).toMatchObject({
      uri: `aitm://workflow-runs/${run.id}/artifacts/plan.md`,
      mimeType: "text/markdown; charset=utf-8",
      text: "# MCP Plan\n",
    });
  });

  it("fails cleanly for unknown resources", async () => {
    const adapter = new AitmMcpResourceAdapter(getContainer());

    await expect(
      adapter.readResource("aitm://workflow-runs/unknown"),
    ).rejects.toThrow("Unknown MCP resource");
  });

  it("keeps listing resources when artifact worktree lookup fails", async () => {
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "review-flow",
    });
    vi.spyOn(getContainer().worktreeService, "findWorktree").mockRejectedValue(
      new Error("git worktree list failed"),
    );

    const adapter = new AitmMcpResourceAdapter(getContainer());
    const resources = await adapter.listResources();

    expect(
      resources.some((resource) => resource.uri === "aitm://config/snapshot"),
    ).toBe(true);
    const artifactsResource = resources.find(
      (resource) => resource.uri === `aitm://workflow-runs/${run.id}/artifacts`,
    );
    expect(artifactsResource).toBeDefined();
    const artifactIndex = await artifactsResource!.read();
    expect(artifactIndex.contents[0]).toMatchObject({
      uri: `aitm://workflow-runs/${run.id}/artifacts`,
      mimeType: "application/json",
    });
    expect(
      "text" in artifactIndex.contents[0] && artifactIndex.contents[0].text,
    ).toContain('"exists": false');
  });

  it("treats zero-byte artifacts as existing readable resources", async () => {
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "review-flow",
    });

    const artifactDir = join(
      worktreePath,
      ".aitm",
      "runs",
      run.id,
      "artifacts",
    );
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "plan.md"), "");

    const adapter = new AitmMcpResourceAdapter(getContainer());
    const artifactListing = await adapter.readResource(
      `aitm://workflow-runs/${run.id}/artifacts`,
    );

    expect(
      "text" in artifactListing.contents[0] && artifactListing.contents[0].text,
    ).toContain('"exists": true');

    await expect(
      adapter.readResource(`aitm://workflow-runs/${run.id}/artifacts/plan.md`),
    ).resolves.toMatchObject({
      contents: [
        {
          uri: `aitm://workflow-runs/${run.id}/artifacts/plan.md`,
          mimeType: "text/markdown; charset=utf-8",
          text: "",
        },
      ],
    });
  });
});
