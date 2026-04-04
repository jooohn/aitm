import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "./api";
import { getOrderedSteps } from "./workflowStepOrder";

describe("getOrderedSteps", () => {
  it("returns steps in BFS order from initial_step", () => {
    const definition: WorkflowDefinition = {
      initial_step: "plan",
      steps: {
        plan: {
          goal: "Create a plan",
          transitions: [
            { step: "implement", when: "plan approved" },
            { terminal: "failure", when: "plan rejected" },
          ],
        },
        implement: {
          goal: "Implement the plan",
          transitions: [
            { step: "review", when: "implementation done" },
            { terminal: "failure", when: "implementation failed" },
          ],
        },
        review: {
          goal: "Review the code",
          transitions: [
            { terminal: "success", when: "review passed" },
            { step: "implement", when: "review rejected" },
          ],
        },
      },
    };

    expect(getOrderedSteps(definition)).toEqual([
      "plan",
      "implement",
      "review",
    ]);
  });

  it("handles a single-step workflow", () => {
    const definition: WorkflowDefinition = {
      initial_step: "run",
      steps: {
        run: {
          goal: "Run the task",
          transitions: [
            { terminal: "success", when: "done" },
            { terminal: "failure", when: "error" },
          ],
        },
      },
    };

    expect(getOrderedSteps(definition)).toEqual(["run"]);
  });

  it("handles diamond-shaped DAG (step reachable from multiple paths)", () => {
    const definition: WorkflowDefinition = {
      initial_step: "start",
      steps: {
        start: {
          goal: "Start",
          transitions: [
            { step: "left", when: "go left" },
            { step: "right", when: "go right" },
          ],
        },
        left: {
          goal: "Left path",
          transitions: [{ step: "merge", when: "done" }],
        },
        right: {
          goal: "Right path",
          transitions: [{ step: "merge", when: "done" }],
        },
        merge: {
          goal: "Merge",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    };

    const result = getOrderedSteps(definition);
    expect(result).toEqual(["start", "left", "right", "merge"]);
  });

  it("does not include unreachable steps", () => {
    const definition: WorkflowDefinition = {
      initial_step: "a",
      steps: {
        a: {
          goal: "Step A",
          transitions: [{ terminal: "success", when: "done" }],
        },
        orphan: {
          goal: "Orphan step",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    };

    expect(getOrderedSteps(definition)).toEqual(["a"]);
  });

  it("handles cycles without infinite loop", () => {
    const definition: WorkflowDefinition = {
      initial_step: "a",
      steps: {
        a: {
          goal: "Step A",
          transitions: [{ step: "b", when: "next" }],
        },
        b: {
          goal: "Step B",
          transitions: [
            { step: "a", when: "retry" },
            { terminal: "success", when: "done" },
          ],
        },
      },
    };

    expect(getOrderedSteps(definition)).toEqual(["a", "b"]);
  });
});
