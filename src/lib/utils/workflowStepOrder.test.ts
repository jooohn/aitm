import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "./api";
import { getOrderedSteps } from "./workflowStepOrder";

function agentStep(
  goal: string,
  transitions: WorkflowDefinition["steps"][string]["transitions"],
): WorkflowDefinition["steps"][string] {
  return {
    type: "agent",
    goal,
    transitions,
  };
}

describe("getOrderedSteps", () => {
  it("returns steps in BFS order from initial_step", () => {
    const definition: WorkflowDefinition = {
      initial_step: "plan",
      steps: {
        plan: agentStep("Create a plan", [
          { step: "implement", when: "plan approved" },
          { terminal: "failure", when: "plan rejected" },
        ]),
        implement: agentStep("Implement the plan", [
          { step: "review", when: "implementation done" },
          { terminal: "failure", when: "implementation failed" },
        ]),
        review: agentStep("Review the code", [
          { terminal: "success", when: "review passed" },
          { step: "implement", when: "review rejected" },
        ]),
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
        run: agentStep("Run the task", [
          { terminal: "success", when: "done" },
          { terminal: "failure", when: "error" },
        ]),
      },
    };

    expect(getOrderedSteps(definition)).toEqual(["run"]);
  });

  it("handles diamond-shaped DAG (step reachable from multiple paths)", () => {
    const definition: WorkflowDefinition = {
      initial_step: "start",
      steps: {
        start: agentStep("Start", [
          { step: "left", when: "go left" },
          { step: "right", when: "go right" },
        ]),
        left: agentStep("Left path", [{ step: "merge", when: "done" }]),
        right: agentStep("Right path", [{ step: "merge", when: "done" }]),
        merge: agentStep("Merge", [{ terminal: "success", when: "done" }]),
      },
    };

    const result = getOrderedSteps(definition);
    expect(result).toEqual(["start", "left", "right", "merge"]);
  });

  it("does not include unreachable steps", () => {
    const definition: WorkflowDefinition = {
      initial_step: "a",
      steps: {
        a: agentStep("Step A", [{ terminal: "success", when: "done" }]),
        orphan: agentStep("Orphan step", [
          { terminal: "success", when: "done" },
        ]),
      },
    };

    expect(getOrderedSteps(definition)).toEqual(["a"]);
  });

  it("handles cycles without infinite loop", () => {
    const definition: WorkflowDefinition = {
      initial_step: "a",
      steps: {
        a: agentStep("Step A", [{ step: "b", when: "next" }]),
        b: agentStep("Step B", [
          { step: "a", when: "retry" },
          { terminal: "success", when: "done" },
        ]),
      },
    };

    expect(getOrderedSteps(definition)).toEqual(["a", "b"]);
  });
});
