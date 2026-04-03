import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@/lib/utils/api";
import {
  buildGraph,
  computeLayout,
  type GraphEdge,
  type GraphNode,
} from "./workflowGraph";

function linearWorkflow(): WorkflowDefinition {
  return {
    initial_state: "plan",
    states: {
      plan: {
        goal: "Create a plan",
        transitions: [
          { state: "implement", when: "plan is ready" },
          { terminal: "failure", when: "planning failed" },
        ],
      },
      implement: {
        goal: "Implement the plan",
        transitions: [
          { terminal: "success", when: "implementation complete" },
          { terminal: "failure", when: "implementation failed" },
        ],
      },
    },
  };
}

function branchingWorkflow(): WorkflowDefinition {
  return {
    initial_state: "triage",
    states: {
      triage: {
        goal: "Triage the issue",
        transitions: [
          { state: "fix_bug", when: "it's a bug" },
          { state: "add_feature", when: "it's a feature request" },
          { terminal: "failure", when: "cannot triage" },
        ],
      },
      fix_bug: {
        goal: "Fix the bug",
        transitions: [
          { state: "review", when: "bug fixed" },
          { terminal: "failure", when: "cannot fix" },
        ],
      },
      add_feature: {
        goal: "Add the feature",
        transitions: [
          { state: "review", when: "feature added" },
          { terminal: "failure", when: "cannot add" },
        ],
      },
      review: {
        goal: "Review changes",
        transitions: [
          { terminal: "success", when: "review passed" },
          { terminal: "failure", when: "review failed" },
        ],
      },
    },
  };
}

describe("buildGraph", () => {
  it("creates nodes for all states and referenced terminals", () => {
    const graph = buildGraph(linearWorkflow());

    const nodeIds = graph.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual(["failure", "implement", "plan", "success"]);

    const planNode = graph.nodes.find((n) => n.id === "plan");
    expect(planNode).toMatchObject({ id: "plan", type: "state" });

    const successNode = graph.nodes.find((n) => n.id === "success");
    expect(successNode).toMatchObject({
      id: "success",
      type: "terminal",
      terminal: "success",
    });

    const failureNode = graph.nodes.find((n) => n.id === "failure");
    expect(failureNode).toMatchObject({
      id: "failure",
      type: "terminal",
      terminal: "failure",
    });
  });

  it("creates edges for all transitions", () => {
    const graph = buildGraph(linearWorkflow());

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "plan",
          to: "implement",
          label: "plan is ready",
        }),
        expect.objectContaining({
          from: "plan",
          to: "failure",
          label: "planning failed",
        }),
        expect.objectContaining({
          from: "implement",
          to: "success",
          label: "implementation complete",
        }),
        expect.objectContaining({
          from: "implement",
          to: "failure",
          label: "implementation failed",
        }),
      ]),
    );
    expect(graph.edges).toHaveLength(4);
  });

  it("handles branching workflows with shared terminals", () => {
    const graph = buildGraph(branchingWorkflow());

    // Should have one success and one failure node, not duplicates
    const terminalNodes = graph.nodes.filter((n) => n.type === "terminal");
    expect(terminalNodes).toHaveLength(2);

    const stateNodes = graph.nodes.filter((n) => n.type === "state");
    expect(stateNodes).toHaveLength(4);
  });

  it("records the initial state", () => {
    const graph = buildGraph(linearWorkflow());
    expect(graph.initialState).toBe("plan");
  });
});

describe("computeLayout", () => {
  it("assigns layers by topological order from initial state", () => {
    const graph = buildGraph(linearWorkflow());
    const layout = computeLayout(graph);

    // plan is layer 0, implement is layer 1, terminals are layer 2
    expect(layout.get("plan")?.layer).toBe(0);
    expect(layout.get("implement")?.layer).toBe(1);
    // success and failure should be in the last layer
    expect(layout.get("success")?.layer).toBe(2);
    expect(layout.get("failure")?.layer).toBe(2);
  });

  it("handles branching paths and assigns converging nodes the max layer", () => {
    const graph = buildGraph(branchingWorkflow());
    const layout = computeLayout(graph);

    // triage is layer 0
    expect(layout.get("triage")?.layer).toBe(0);
    // fix_bug and add_feature are layer 1
    expect(layout.get("fix_bug")?.layer).toBe(1);
    expect(layout.get("add_feature")?.layer).toBe(1);
    // review converges from both branches - should be layer 2
    expect(layout.get("review")?.layer).toBe(2);
    // terminals after review - layer 3
    expect(layout.get("success")?.layer).toBe(3);
    // failure is reachable from multiple layers; should use max
    expect(layout.get("failure")?.layer).toBeGreaterThanOrEqual(3);
  });

  it("terminates on cyclic graphs without infinite loop", () => {
    const cyclicWorkflow: WorkflowDefinition = {
      initial_state: "a",
      states: {
        a: {
          goal: "State A",
          transitions: [
            { state: "b", when: "go to b" },
            { terminal: "failure", when: "fail" },
          ],
        },
        b: {
          goal: "State B",
          transitions: [
            { state: "a", when: "go back to a" },
            { terminal: "success", when: "done" },
          ],
        },
      },
    };

    const graph = buildGraph(cyclicWorkflow);
    // Should terminate without infinite loop
    const layout = computeLayout(graph);

    // All nodes should be assigned a finite layer capped at (nodeCount - 1)
    for (const [, pos] of layout) {
      expect(pos.layer).toBeLessThan(graph.nodes.length);
      expect(pos.layer).toBeGreaterThanOrEqual(0);
    }
    // b should be reachable from a
    expect(layout.get("b")?.layer).toBeGreaterThanOrEqual(1);
  });

  it("assigns different positions within the same layer", () => {
    const graph = buildGraph(branchingWorkflow());
    const layout = computeLayout(graph);

    const fixBug = layout.get("fix_bug");
    const addFeature = layout.get("add_feature");
    expect(fixBug?.layer).toBe(addFeature?.layer);
    expect(fixBug?.index).not.toBe(addFeature?.index);
  });
});
