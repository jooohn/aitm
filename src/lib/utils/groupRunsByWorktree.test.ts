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
  it("excludes main worktree from results", () => {
    const worktrees = [
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "feature-a", is_main: false }),
    ];
    const result = groupRunsByWorktree(worktrees, []);

    expect(result).toHaveLength(1);
    expect(result[0].worktree!.branch).toBe("feature-a");
    expect(result[0].runs).toEqual([]);
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

    // main is excluded, r3 goes to orphaned
    const featureGroup = result.find(
      (g) => g.worktree?.branch === "feature-a",
    )!;
    expect(featureGroup.runs).toHaveLength(2);

    // main's run becomes orphaned since main worktree is hidden
    const orphaned = result.find((g) => g.worktree === null);
    expect(orphaned).toBeDefined();
    expect(orphaned!.runs).toHaveLength(1);
    expect(orphaned!.runs[0].id).toBe("r3");
  });

  it("puts orphaned runs (no matching worktree) in a separate group at the end", () => {
    const worktrees = [makeWorktree({ branch: "main", is_main: true })];
    const runs = [
      makeRun({ id: "r1", worktree_branch: "deleted-branch" }),
      makeRun({ id: "r2", worktree_branch: "another-deleted" }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    expect(result).toHaveLength(1); // orphaned only (main excluded)
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

  it("sorts by oldest run created_at descending (most recently started first)", () => {
    const worktrees = [
      makeWorktree({ branch: "alpha", is_main: false }),
      makeWorktree({ branch: "beta", is_main: false }),
      makeWorktree({ branch: "gamma", is_main: false }),
    ];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "gamma",
        created_at: "2026-04-03T00:00:00Z",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "alpha",
        created_at: "2026-04-01T00:00:00Z",
      }),
      makeRun({
        id: "r3",
        worktree_branch: "beta",
        created_at: "2026-04-02T00:00:00Z",
      }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    const branches = result.map((g) => g.worktree?.branch ?? "(orphaned)");
    expect(branches[0]).toBe("gamma"); // oldest run: Apr 3
    expect(branches[1]).toBe("beta"); // oldest run: Apr 2
    expect(branches[2]).toBe("alpha"); // oldest run: Apr 1
  });

  it("sorts worktrees with no runs after those with runs, alphabetically", () => {
    const worktrees = [
      makeWorktree({ branch: "zebra", is_main: false }),
      makeWorktree({ branch: "alpha", is_main: false }),
      makeWorktree({ branch: "beta", is_main: false }),
    ];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "beta",
        created_at: "2026-04-01T00:00:00Z",
      }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    const branches = result.map((g) => g.worktree?.branch);
    expect(branches[0]).toBe("beta"); // has runs
    expect(branches[1]).toBe("alpha"); // no runs, alphabetical
    expect(branches[2]).toBe("zebra"); // no runs, alphabetical
  });

  it("uses oldest (earliest) run when worktree has multiple runs", () => {
    const worktrees = [
      makeWorktree({ branch: "feature-a", is_main: false }),
      makeWorktree({ branch: "feature-b", is_main: false }),
    ];
    const runs = [
      // feature-a has runs from Apr 3 and Apr 5 — oldest is Apr 3
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        created_at: "2026-04-05T00:00:00Z",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "feature-a",
        created_at: "2026-04-03T00:00:00Z",
      }),
      // feature-b has a single run from Apr 4
      makeRun({
        id: "r3",
        worktree_branch: "feature-b",
        created_at: "2026-04-04T00:00:00Z",
      }),
    ];
    const result = groupRunsByWorktree(worktrees, runs);

    // feature-b oldest=Apr 4 > feature-a oldest=Apr 3
    expect(result[0].worktree!.branch).toBe("feature-b");
    expect(result[1].worktree!.branch).toBe("feature-a");
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
