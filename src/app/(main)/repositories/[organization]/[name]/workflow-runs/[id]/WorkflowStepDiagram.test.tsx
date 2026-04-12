// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StepExecution,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "@/lib/utils/api";
import WorkflowStepDiagram from "./WorkflowStepDiagram";

afterEach(() => {
  cleanup();
});

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

function linearWorkflow(): WorkflowDefinition {
  return {
    initial_step: "plan",
    steps: {
      plan: agentStep("Create a plan", [
        { step: "implement", when: "plan is ready" },
        { terminal: "failure", when: "planning failed" },
      ]),
      implement: agentStep("Implement the plan", [
        { terminal: "success", when: "implementation complete" },
        { terminal: "failure", when: "implementation failed" },
      ]),
    },
  };
}

function makeExecution(
  overrides: Partial<StepExecution> & { step: string },
): StepExecution {
  const { step, ...rest } = overrides;
  return {
    id: `${step}-execution`,
    workflow_run_id: "run-1",
    step,
    step_type: "agent",
    status: "success",
    output_file_path: null,
    session_id: null,
    session_status: null,
    command_execution_id: null,
    transition_decision: null,
    handoff_summary: null,
    created_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:05:00Z",
    ...rest,
  };
}

describe("WorkflowStepDiagram", () => {
  it("renders all state nodes from the workflow definition", () => {
    render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );

    expect(screen.getByText("plan")).toBeInTheDocument();
    expect(screen.getByText("implement")).toBeInTheDocument();
  });

  it("renders only success terminal node (no failure terminal)", () => {
    render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );

    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();

    // Only success terminal should be rendered, not failure
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.queryByText("Failure")).not.toBeInTheDocument();
  });

  it("highlights executed states", () => {
    const executions = [
      makeExecution({
        step: "plan",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="running"
      />,
    );

    // The plan node should have the "executed" data attribute
    const planNode = container.querySelector('[data-node-id="plan"]');
    expect(planNode).not.toBeNull();
    expect(planNode?.getAttribute("data-executed")).toBe("true");

    // implement is current, not yet completed
    const implementNode = container.querySelector('[data-node-id="implement"]');
    expect(implementNode).not.toBeNull();
    expect(implementNode?.getAttribute("data-current")).toBe("true");
  });

  it("highlights the current running state", () => {
    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep="plan"
        status="running"
      />,
    );

    const planNode = container.querySelector('[data-node-id="plan"]');
    expect(planNode?.getAttribute("data-current")).toBe("true");
  });

  it("marks the failed step node with data-failed when run has failed", () => {
    const executions = [
      makeExecution({
        step: "plan",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="failure"
      />,
    );

    // The implement node (where the run failed) should have data-failed="true"
    const implementNode = container.querySelector('[data-node-id="implement"]');
    expect(implementNode?.getAttribute("data-failed")).toBe("true");

    // The plan node should not be marked as failed
    const planNode = container.querySelector('[data-node-id="plan"]');
    expect(planNode?.getAttribute("data-failed")).toBe("false");
  });

  it("highlights executed edges along the path", () => {
    const executions = [
      makeExecution({
        step: "plan",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="running"
      />,
    );

    // The edge from plan to implement should be highlighted
    const executedEdge = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="implement"]',
    );
    expect(executedEdge).not.toBeNull();
    expect(executedEdge?.getAttribute("data-executed")).toBe("true");

    // There should be no edge to the failure terminal (it no longer exists)
    const failureEdge = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="failure"]',
    );
    expect(failureEdge).toBeNull();
  });

  it("marks terminal node as executed when run is terminal", () => {
    const executions = [
      makeExecution({
        step: "plan",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
      makeExecution({
        step: "implement",
        transition_decision: {
          transition: "success",
          reason: "Done",
          handoff_summary: "All done",
        },
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep={null}
        status="success"
      />,
    );

    const successNode = container.querySelector('[data-node-id="success"]');
    expect(successNode?.getAttribute("data-executed")).toBe("true");
  });

  it("uses terminal radius for edge endpoints to terminal nodes", () => {
    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );

    // Get an edge that goes to a terminal node (implement -> success)
    const edgeToTerminal = container.querySelector(
      '[data-edge-from="implement"][data-edge-to="success"] line',
    );
    expect(edgeToTerminal).not.toBeNull();

    // Get an edge between two state nodes (plan -> implement)
    const edgeBetweenStates = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="implement"] line',
    );
    expect(edgeBetweenStates).not.toBeNull();

    // The endpoint x2 for edges to terminal nodes should be different
    // from edges to state nodes (terminal uses radius 22 vs state uses width/2 = 70)
    const terminalEndX = Number(edgeToTerminal!.getAttribute("x2"));
    const _stateEndX = Number(edgeBetweenStates!.getAttribute("x2"));

    // The terminal node center and state node center at the same layer would be
    // at the same x, so the difference in x2 values reflects the different offsets.
    // Terminal edge should end closer to center (smaller offset = 22) vs state (offset = 70)
    // Since they're at different layers, we compare: endX = centerX - offset
    // For terminal: centerX_terminal - 22; for state: centerX_state - 70
    // The edges go to different layers, so we check the offset from the target center
    // by computing center positions from the layout constants.
    // NODE_WIDTH=140, LAYER_GAP=180, PADDING=24, TERMINAL_RADIUS=30

    // success center x = 24 + 2*180 + 70 = 454
    // Edge to terminal should end at: 454 - 30 = 424
    expect(terminalEndX).toBe(424);
  });

  it("uses terminal radius for edge start from terminal nodes if applicable", () => {
    // This tests the start offset when source is a terminal (unlikely but defensive)
    // For now, just verify the fix doesn't break normal state->state edges
    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );

    // plan -> implement: startX should use NODE_WIDTH/2 = 70
    const edge = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="implement"] line',
    );
    // plan center x = 24 + 0*180 + 70 = 94
    // startX = 94 + 70 = 164
    expect(Number(edge!.getAttribute("x1"))).toBe(164);
  });

  it("does not render edge labels", () => {
    render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );

    expect(screen.queryByText("plan is ready")).not.toBeInTheDocument();
    expect(
      screen.queryByText("implementation complete"),
    ).not.toBeInTheDocument();
  });

  it("dedupes edges when multiple transitions share the same from and to", () => {
    const workflow: WorkflowDefinition = {
      initial_step: "cleanup",
      steps: {
        cleanup: agentStep("Cleanup files", [
          { step: "commit", when: "succeeded" },
          { step: "commit", when: "failed" },
        ]),
        commit: agentStep("Commit", [{ terminal: "success", when: "done" }]),
      },
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <WorkflowStepDiagram
        definition={workflow}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );
    consoleSpy.mockRestore();

    const edges = container.querySelectorAll(
      '[data-edge-from="cleanup"][data-edge-to="commit"]',
    );
    expect(edges).toHaveLength(1);

    const duplicateKeyWarnings = consoleSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("Encountered two children with the same key"),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it("sets data-node-status based on step execution status for executed nodes", () => {
    const executions = [
      makeExecution({
        step: "plan",
        status: "success",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="running"
      />,
    );

    const planNode = container.querySelector('[data-node-id="plan"]');
    expect(planNode?.getAttribute("data-node-status")).toBe("success");
  });

  it("sets data-node-status='running' on the current running node", () => {
    const executions = [
      makeExecution({
        step: "plan",
        status: "success",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
      makeExecution({
        step: "implement",
        status: "running",
        completed_at: null,
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="running"
      />,
    );

    const implementNode = container.querySelector('[data-node-id="implement"]');
    expect(implementNode?.getAttribute("data-node-status")).toBe("running");
  });

  it("sets data-node-status='awaiting' on an awaiting node", () => {
    const executions = [
      makeExecution({
        step: "plan",
        status: "success",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
      makeExecution({
        step: "implement",
        status: "awaiting",
        completed_at: null,
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="awaiting"
      />,
    );

    const implementNode = container.querySelector('[data-node-id="implement"]');
    expect(implementNode?.getAttribute("data-node-status")).toBe("awaiting");
  });

  it("sets data-node-status='failure' on a failed node", () => {
    const executions = [
      makeExecution({
        step: "plan",
        status: "success",
        transition_decision: {
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        },
      }),
      makeExecution({
        step: "implement",
        status: "failure",
        completed_at: "2024-01-01T00:10:00Z",
      }),
    ];

    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={executions}
        currentStep="implement"
        status="failure"
      />,
    );

    const implementNode = container.querySelector('[data-node-id="implement"]');
    expect(implementNode?.getAttribute("data-node-status")).toBe("failure");
  });

  it("does not set data-node-status on nodes that have not been executed", () => {
    const { container } = render(
      <WorkflowStepDiagram
        definition={linearWorkflow()}
        stepExecutions={[]}
        currentStep="plan"
        status="running"
      />,
    );

    const implementNode = container.querySelector('[data-node-id="implement"]');
    expect(implementNode?.hasAttribute("data-node-status")).toBe(false);
  });

  it("renders back-edges as curved paths instead of straight lines", () => {
    const cyclicWorkflow: WorkflowDefinition = {
      initial_step: "implement",
      steps: {
        implement: agentStep("Implement", [
          { step: "test", when: "ready" },
          { terminal: "failure", when: "blocked" },
        ]),
        test: agentStep("Test", [
          { step: "implement", when: "failed" },
          { terminal: "success", when: "passed" },
        ]),
      },
    };

    const { container } = render(
      <WorkflowStepDiagram
        definition={cyclicWorkflow}
        stepExecutions={[]}
        currentStep={null}
        status="running"
      />,
    );

    // The back-edge test→implement should use a <path> element (curve), not <line>
    const backEdge = container.querySelector(
      '[data-edge-from="test"][data-edge-to="implement"]',
    );
    expect(backEdge).not.toBeNull();
    expect(backEdge!.querySelector("path")).not.toBeNull();
    expect(backEdge!.querySelector("line")).toBeNull();

    // The forward edge implement→test should still use a <line>
    const forwardEdge = container.querySelector(
      '[data-edge-from="implement"][data-edge-to="test"]',
    );
    expect(forwardEdge).not.toBeNull();
    expect(forwardEdge!.querySelector("line")).not.toBeNull();
  });
});
