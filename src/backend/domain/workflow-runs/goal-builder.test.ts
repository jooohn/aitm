import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildGoal, resolveWorkflowArtifacts } from "./goal-builder";

describe("resolveWorkflowArtifacts", () => {
  it("returns empty array when no artifacts are provided", () => {
    expect(resolveWorkflowArtifacts("run-1", "/tmp/wt")).toEqual([]);
    expect(resolveWorkflowArtifacts("run-1", "/tmp/wt", [])).toEqual([]);
    expect(resolveWorkflowArtifacts("run-1", "/tmp/wt", undefined)).toEqual([]);
  });

  it("resolves artifact paths relative to the worktree run directory", () => {
    const result = resolveWorkflowArtifacts("run-1", "/tmp/wt", [
      { name: "plan", path: "plan.md", description: "The plan" },
      { name: "notes", path: "sub/notes.txt" },
    ]);

    expect(result).toEqual([
      {
        name: "plan",
        path: join("/tmp/wt", ".aitm", "runs", "run-1", "artifacts", "plan.md"),
        description: "The plan",
      },
      {
        name: "notes",
        path: join(
          "/tmp/wt",
          ".aitm",
          "runs",
          "run-1",
          "artifacts",
          "sub/notes.txt",
        ),
        description: undefined,
      },
    ]);
  });
});

describe("buildGoal", () => {
  it("wraps the step goal in <goal> tags", () => {
    const result = buildGoal("Do the thing", [], []);
    expect(result).toContain("<goal>");
    expect(result).toContain("Do the thing");
    expect(result).toContain("</goal>");
  });

  it("includes inputs when there are no previous executions", () => {
    const result = buildGoal("Do the thing", [], [], {
      ticket: "ABC-123",
      scope: "backend",
    });
    expect(result).toContain("<inputs>");
    expect(result).toContain("ticket: ABC-123");
    expect(result).toContain("scope: backend");
    expect(result).toContain("</inputs>");
  });

  it("omits inputs when there are previous executions", () => {
    const result = buildGoal(
      "Do the thing",
      [
        {
          step: "plan",
          handoff_summary: "Done",
          log_file_path: null,
          output_file_path: null,
        },
      ],
      [],
      { ticket: "ABC-123" },
    );
    expect(result).not.toContain("<inputs>");
  });

  it("omits inputs section when inputs is empty", () => {
    const result = buildGoal("Do the thing", [], [], {});
    expect(result).not.toContain("<inputs>");
  });

  it("omits inputs section when inputs is undefined", () => {
    const result = buildGoal("Do the thing", [], []);
    expect(result).not.toContain("<inputs>");
  });

  it("includes artifacts section with descriptions", () => {
    const result = buildGoal(
      "Do the thing",
      [],
      [
        { name: "plan", path: "/tmp/plan.md", description: "Shared plan" },
        { name: "notes", path: "/tmp/notes.txt" },
      ],
    );
    expect(result).toContain("<artifacts>");
    expect(result).toContain("Artifact: plan");
    expect(result).toContain("Path: /tmp/plan.md");
    expect(result).toContain("Description: Shared plan");
    expect(result).toContain("Artifact: notes");
    expect(result).toContain("Path: /tmp/notes.txt");
    expect(result).not.toContain("Description: undefined");
    expect(result).toContain("</artifacts>");
  });

  it("omits artifacts section when empty", () => {
    const result = buildGoal("Do the thing", [], []);
    expect(result).not.toContain("<artifacts>");
  });

  it("includes handoff section with previous executions", () => {
    const result = buildGoal(
      "Implement",
      [
        {
          step: "plan",
          handoff_summary: "Plan written",
          log_file_path: "/tmp/plan.log",
          output_file_path: null,
        },
        {
          step: "test",
          handoff_summary: "Tests added",
          log_file_path: null,
          output_file_path: "/tmp/test-output.log",
        },
      ],
      [],
    );
    expect(result).toContain("<handoff>");
    expect(result).toContain("Previous steps (oldest first):");
    expect(result).toContain("Step: plan");
    expect(result).toContain("Summary: Plan written");
    expect(result).toContain("Log: /tmp/plan.log");
    expect(result).toContain("Step: test");
    expect(result).toContain("Summary: Tests added");
    expect(result).toContain("Output: /tmp/test-output.log");
    expect(result).toContain("</handoff>");
  });

  it("omits Log/Output lines when paths are null", () => {
    const result = buildGoal(
      "Implement",
      [
        {
          step: "plan",
          handoff_summary: "Done",
          log_file_path: null,
          output_file_path: null,
        },
      ],
      [],
    );
    expect(result).not.toContain("Log:");
    expect(result).not.toContain("Output:");
  });

  it("omits handoff section when no previous executions", () => {
    const result = buildGoal("Do it", [], []);
    expect(result).not.toContain("<handoff>");
  });
});
