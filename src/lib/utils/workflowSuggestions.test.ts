import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowRunDetail } from "./api";
import {
  allRequiredInputsProvided,
  resolveWorkflowSuggestions,
} from "./workflowSuggestions";

function makeRun(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    organization: "tmp",
    name: "repo",
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
  it("returns target workflows whose recommended_when selector resolves truthy", () => {
    const suggestions = resolveWorkflowSuggestions(
      makeRun({
        metadata: {
          presets__pull_request_url: "https://github.com/org/repo/pull/42",
        },
      }),
      {
        develop: makeWorkflow(),
        "maintain-pr": makeWorkflow({
          label: "Maintain PR",
          recommended_when: {
            condition: "$.run.metadata.presets__pull_request_url",
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
        recommended_when: {
          condition: "$.run.metadata.presets__pull_request_url",
        },
      }),
    });

    expect(suggestions).toEqual([]);
  });
});

describe("allRequiredInputsProvided", () => {
  it("returns true when all required inputs have values", () => {
    const workflow = makeWorkflow({
      inputs: [
        { name: "pr-url", label: "PR URL", required: true },
        { name: "source-run-id", label: "Source Run", required: true },
      ],
    });
    expect(
      allRequiredInputsProvided(workflow, {
        "pr-url": "https://github.com/org/repo/pull/42",
        "source-run-id": "run-1",
      }),
    ).toBe(true);
  });

  it("returns false when a required input is missing", () => {
    const workflow = makeWorkflow({
      inputs: [
        { name: "pr-url", label: "PR URL", required: true },
        { name: "source-run-id", label: "Source Run", required: true },
      ],
    });
    expect(
      allRequiredInputsProvided(workflow, { "pr-url": "https://example.com" }),
    ).toBe(false);
  });

  it("returns false when a required input is empty string", () => {
    const workflow = makeWorkflow({
      inputs: [{ name: "pr-url", label: "PR URL", required: true }],
    });
    expect(allRequiredInputsProvided(workflow, { "pr-url": "" })).toBe(false);
  });

  it("returns false when a required input is whitespace-only", () => {
    const workflow = makeWorkflow({
      inputs: [{ name: "pr-url", label: "PR URL", required: true }],
    });
    expect(allRequiredInputsProvided(workflow, { "pr-url": "   " })).toBe(
      false,
    );
  });

  it("ignores optional inputs", () => {
    const workflow = makeWorkflow({
      inputs: [
        { name: "pr-url", label: "PR URL", required: true },
        { name: "notes", label: "Notes", required: false },
      ],
    });
    expect(
      allRequiredInputsProvided(workflow, { "pr-url": "https://example.com" }),
    ).toBe(true);
  });

  it("treats inputs without explicit required field as required", () => {
    const workflow = makeWorkflow({
      inputs: [{ name: "pr-url", label: "PR URL" }],
    });
    expect(allRequiredInputsProvided(workflow, {})).toBe(false);
  });

  it("returns true when workflow has no inputs", () => {
    const workflow = makeWorkflow({ inputs: [] });
    expect(allRequiredInputsProvided(workflow, {})).toBe(true);
  });

  it("returns true when workflow inputs are undefined", () => {
    const workflow = makeWorkflow();
    expect(allRequiredInputsProvided(workflow, {})).toBe(true);
  });
});
