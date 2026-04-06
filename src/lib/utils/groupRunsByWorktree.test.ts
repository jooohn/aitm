import { describe, expect, it } from "vitest";
import type { WorkflowRun, Worktree } from "@/lib/utils/api";
import { groupRunsByWorktree } from "./groupRunsByWorktree";

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    branch: "main",
    path: "/repo/main",
    is_main: true,
    is_bare: false,
    head: "abc123",
    ...overrides,
  };
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    repository_path: "/repos/org/name",
    worktree_branch: "feature-a",
    workflow_name: "develop",
    current_step: "code",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupRunsByWorktree", () => {
  it("returns worktrees with no runs as empty groups", () => {
    const worktrees = [
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "feature-a", is_main: false }),
    ];
    const result = groupRunsByWorktree(worktrees, []);

    expect(result).toHaveLength(2);
    expect(result[0].worktree.branch).toBe("main");
    expect(result[0].runs).toEqual([]);
    expect(result[1].worktree.branch).toBe("feature-a");
    expect(result[1].runs).toEqual([]);
  });

  it("groups runs under their matching worktree by branch", () => {
    const worktrees = [
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "feature-a", is_main: false }),
    ];
    const runs = [
      makeRun({ id: "r1", worktree_branch: "feature-a" }),
      makeRun({
        id: "r2",
        worktree_branch: "feature-a",
        workflow_name: "maintain-pr",
      }),
      makeRun({ id: "r3", worktree_branch: "main" }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    const mainGroup = result.find((g) => g.worktree.branch === "main")!;
    expect(mainGroup.runs).toHaveLength(1);
    expect(mainGroup.runs[0].id).toBe("r3");

    const featureGroup = result.find((g) => g.worktree.branch === "feature-a")!;
    expect(featureGroup.runs).toHaveLength(2);
  });

  it("puts orphaned runs (no matching worktree) in a separate group at the end", () => {
    const worktrees = [makeWorktree({ branch: "main", is_main: true })];
    const runs = [
      makeRun({ id: "r1", worktree_branch: "deleted-branch" }),
      makeRun({ id: "r2", worktree_branch: "another-deleted" }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    expect(result).toHaveLength(2); // main + orphaned
    const orphaned = result[result.length - 1];
    expect(orphaned.worktree).toBeNull();
    expect(orphaned.runs).toHaveLength(2);
  });

  it("does not create orphaned group when all runs have matching worktrees", () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [makeRun({ id: "r1", worktree_branch: "feature-a" })];
    const result = groupRunsByWorktree(worktrees, runs);

    expect(result).toHaveLength(1);
    expect(result[0].worktree).not.toBeNull();
  });

  it("sorts worktrees with running runs first, then by branch name", () => {
    const worktrees = [
      makeWorktree({ branch: "alpha", is_main: false }),
      makeWorktree({ branch: "beta", is_main: false }),
      makeWorktree({ branch: "gamma", is_main: false }),
      makeWorktree({ branch: "main", is_main: true }),
    ];
    const runs = [
      makeRun({ id: "r1", worktree_branch: "gamma", status: "running" }),
      makeRun({ id: "r2", worktree_branch: "alpha", status: "success" }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    // gamma has a running run, should come first among non-main
    // main worktree stays at top
    const branches = result.map((g) => g.worktree?.branch ?? "(orphaned)");
    expect(branches[0]).toBe("main");
    expect(branches[1]).toBe("gamma"); // has running run
  });

  it("keeps main worktree first regardless of run status", () => {
    const worktrees = [
      makeWorktree({ branch: "feature-a", is_main: false }),
      makeWorktree({ branch: "main", is_main: true }),
    ];
    const runs = [
      makeRun({ id: "r1", worktree_branch: "feature-a", status: "running" }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    expect(result[0].worktree!.branch).toBe("main");
  });

  it("preserves run order (most recent first) within each group", () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        created_at: "2026-04-03T00:00:00Z",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "feature-a",
        created_at: "2026-04-01T00:00:00Z",
      }),
      makeRun({
        id: "r3",
        worktree_branch: "feature-a",
        created_at: "2026-04-02T00:00:00Z",
      }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    // Input order is preserved (API already returns sorted)
    expect(result[0].runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("indicates which groups have running workflows", () => {
    const worktrees = [
      makeWorktree({ branch: "active", is_main: false }),
      makeWorktree({ branch: "idle", is_main: false }),
    ];
    const runs = [
      makeRun({ id: "r1", worktree_branch: "active", status: "running" }),
      makeRun({ id: "r2", worktree_branch: "idle", status: "success" }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    const activeGroup = result.find((g) => g.worktree?.branch === "active")!;
    const idleGroup = result.find((g) => g.worktree?.branch === "idle")!;
    expect(activeGroup.hasRunningWorkflow).toBe(true);
    expect(idleGroup.hasRunningWorkflow).toBe(false);
  });
});
