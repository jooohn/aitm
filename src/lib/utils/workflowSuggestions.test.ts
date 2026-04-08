import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowRunDetail } from "./api";
import { resolveWorkflowSuggestions } from "./workflowSuggestions";

function makeRun(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    repository_path: "/tmp/repo",
    worktree_branch: "feat/test",
    workflow_name: "develop",
    current_step: null,
    status: "success",
    inputs: null,
    metadata: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:05:00Z",
    step_executions: [],
    ...overrides,
  };
}

function makeWorkflow(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    initial_step: "step",
    steps: {
      step: {
        type: "agent",
        goal: "Do work",
        transitions: [{ terminal: "success", when: "done" }],
      },
    },
    ...overrides,
  };
}

describe("resolveWorkflowSuggestions", () => {
  it("returns target workflows whose suggest_if selector resolves truthy", () => {
    const suggestions = resolveWorkflowSuggestions(
      makeRun({
        metadata: {
          presets__pull_request_url: "https://github.com/org/repo/pull/42",
        },
      }),
      {
        develop: makeWorkflow(),
        "maintain-pr": makeWorkflow({
          suggest_if: {
            label: "Maintain PR",
            when: "$.run.metadata.presets__pull_request_url",
            inputs: {
              "pr-url": "$.run.metadata.presets__pull_request_url",
              "source-run-id": "$.run.id",
            },
          },
        }),
      },
    );

    expect(suggestions).toEqual([
      {
        workflow: "maintain-pr",
        label: "Maintain PR",
        inputValues: {
          "pr-url": "https://github.com/org/repo/pull/42",
          "source-run-id": "run-1",
        },
      },
    ]);
  });

  it("ignores workflows whose selector resolves empty", () => {
    const suggestions = resolveWorkflowSuggestions(makeRun(), {
      develop: makeWorkflow(),
      "maintain-pr": makeWorkflow({
        suggest_if: {
          when: "$.run.metadata.presets__pull_request_url",
        },
      }),
    });

    expect(suggestions).toEqual([]);
  });
});
