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
    initial_step: "plan",
    steps: {
      plan: {
        goal: "Create a plan",
        transitions: [
          { step: "implement", when: "plan is ready" },
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
    initial_step: "triage",
    steps: {
      triage: {
        goal: "Triage the issue",
        transitions: [
          { step: "fix_bug", when: "it's a bug" },
          { step: "add_feature", when: "it's a feature request" },
          { terminal: "failure", when: "cannot triage" },
        ],
      },
      fix_bug: {
        goal: "Fix the bug",
        transitions: [
          { step: "review", when: "bug fixed" },
          { terminal: "failure", when: "cannot fix" },
        ],
      },
      add_feature: {
        goal: "Add the feature",
        transitions: [
          { step: "review", when: "feature added" },
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
    expect(nodeIds).toEqual(["implement", "plan", "success"]);

    const planNode = graph.nodes.find((n) => n.id === "plan");
    expect(planNode).toMatchObject({ id: "plan", type: "step" });

    const successNode = graph.nodes.find((n) => n.id === "success");
    expect(successNode).toMatchObject({
      id: "success",
      type: "terminal",
      terminal: "success",
    });

    // No failure terminal node
    const failureNode = graph.nodes.find((n) => n.id === "failure");
    expect(failureNode).toBeUndefined();
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
          from: "implement",
          to: "success",
          label: "implementation complete",
        }),
      ]),
    );
    // No edges to failure terminal
    const failureEdges = graph.edges.filter((e) => e.to === "failure");
    expect(failureEdges).toHaveLength(0);
    expect(graph.edges).toHaveLength(2);
  });

  it("handles branching workflows with shared terminals", () => {
    const graph = buildGraph(branchingWorkflow());

    // Should have only one terminal node (success), no failure terminal
    const terminalNodes = graph.nodes.filter((n) => n.type === "terminal");
    expect(terminalNodes).toHaveLength(1);
    expect(terminalNodes[0].terminal).toBe("success");

    const stateNodes = graph.nodes.filter((n) => n.type === "step");
    expect(stateNodes).toHaveLength(4);
  });

  it("records the initial state", () => {
    const graph = buildGraph(linearWorkflow());
    expect(graph.initialStep).toBe("plan");
  });
});

describe("computeLayout", () => {
  it("assigns layers by topological order from initial state", () => {
    const graph = buildGraph(linearWorkflow());
    const layout = computeLayout(graph);

    // plan is layer 0, implement is layer 1, success terminal is layer 2
    expect(layout.get("plan")?.layer).toBe(0);
    expect(layout.get("implement")?.layer).toBe(1);
    expect(layout.get("success")?.layer).toBe(2);
    // No failure terminal in layout
    expect(layout.has("failure")).toBe(false);
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
    // success terminal after review - layer 3
    expect(layout.get("success")?.layer).toBe(3);
    // No failure terminal in layout
    expect(layout.has("failure")).toBe(false);
  });

  it("terminates on cyclic graphs without infinite loop", () => {
    const cyclicWorkflow: WorkflowDefinition = {
      initial_step: "a",
      steps: {
        a: {
          goal: "State A",
          transitions: [
            { step: "b", when: "go to b" },
            { terminal: "failure", when: "fail" },
          ],
        },
        b: {
          goal: "State B",
          transitions: [
            { step: "a", when: "go back to a" },
            { terminal: "success", when: "done" },
          ],
        },
      },
    };

    const graph = buildGraph(cyclicWorkflow);
    // Should terminate without infinite loop
    const layout = computeLayout(graph);

    // All nodes should be assigned a finite layer
    for (const [, pos] of layout) {
      expect(pos.layer).toBeLessThan(graph.nodes.length);
      expect(pos.layer).toBeGreaterThanOrEqual(0);
    }
    // b should be reachable from a
    expect(layout.get("b")?.layer).toBeGreaterThanOrEqual(1);
  });

  it("assigns stable layers for cyclic development-flow workflow", () => {
    const devFlow: WorkflowDefinition = {
      initial_step: "plan",
      steps: {
        plan: {
          goal: "Create a plan",
          transitions: [
            { step: "implement", when: "plan is ready" },
            { terminal: "failure", when: "planning failed" },
          ],
        },
        implement: {
          goal: "Implement the plan",
          transitions: [
            { step: "test", when: "implementation complete" },
            { terminal: "failure", when: "blocked" },
          ],
        },
        test: {
          goal: "Run tests",
          transitions: [
            { step: "review", when: "succeeded" },
            { step: "implement", when: "failed" },
          ],
        },
        review: {
          goal: "Review changes",
          transitions: [
            { step: "implement", when: "issues found" },
            { step: "cleanup", when: "looks good" },
            { terminal: "failure", when: "abandon" },
          ],
        },
        cleanup: {
          goal: "Cleanup",
          transitions: [
            { step: "commit", when: "succeeded" },
            { step: "commit", when: "failed" },
          ],
        },
        commit: {
          goal: "Commit and push",
          transitions: [
            { terminal: "success", when: "PR created" },
            { terminal: "failure", when: "failed" },
          ],
        },
      },
    };

    const graph = buildGraph(devFlow);
    const layout = computeLayout(graph);

    // Nodes in the cycle (implement, test, review) should keep their
    // first-visit layers rather than being pushed to the max layer.
    expect(layout.get("plan")?.layer).toBe(0);
    expect(layout.get("implement")?.layer).toBe(1);
    expect(layout.get("test")?.layer).toBe(2);
    expect(layout.get("review")?.layer).toBe(3);
    expect(layout.get("cleanup")?.layer).toBe(4);
    expect(layout.get("commit")?.layer).toBe(5);

    // Terminal nodes should be placed after their latest predecessor
    const successLayer = layout.get("success")?.layer ?? -1;
    expect(successLayer).toBe(6);
    // No failure terminal in layout
    expect(layout.has("failure")).toBe(false);
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
