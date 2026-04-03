// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type {
  StateExecution,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "@/lib/utils/api";
import WorkflowStateDiagram from "./WorkflowStateDiagram";

afterEach(() => {
  cleanup();
});

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

function makeExecution(
  overrides: Partial<StateExecution> & { state: string },
): StateExecution {
  return {
    id: `${overrides.state}-execution`,
    workflow_run_id: "run-1",
    state: overrides.state,
    state_type: "agent",
    command_output: null,
    session_id: null,
    session_status: null,
    transition_decision: null,
    handoff_summary: null,
    created_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:05:00Z",
    ...overrides,
  };
}

describe("WorkflowStateDiagram", () => {
  it("renders all state nodes from the workflow definition", () => {
    render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={[]}
        currentState={null}
        status="running"
      />,
    );

    expect(screen.getByText("plan")).toBeInTheDocument();
    expect(screen.getByText("implement")).toBeInTheDocument();
  });

  it("renders terminal nodes", () => {
    render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={[]}
        currentState={null}
        status="running"
      />,
    );

    // Terminal nodes should show success/failure markers
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();

    // Check for terminal node text
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Failure")).toBeInTheDocument();
  });

  it("highlights executed states", () => {
    const executions = [
      makeExecution({
        state: "plan",
        transition_decision: JSON.stringify({
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        }),
      }),
    ];

    const { container } = render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={executions}
        currentState="implement"
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
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={[]}
        currentState="plan"
        status="running"
      />,
    );

    const planNode = container.querySelector('[data-node-id="plan"]');
    expect(planNode?.getAttribute("data-current")).toBe("true");
  });

  it("highlights executed edges along the path", () => {
    const executions = [
      makeExecution({
        state: "plan",
        transition_decision: JSON.stringify({
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        }),
      }),
    ];

    const { container } = render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={executions}
        currentState="implement"
        status="running"
      />,
    );

    // The edge from plan to implement should be highlighted
    const executedEdge = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="implement"]',
    );
    expect(executedEdge).not.toBeNull();
    expect(executedEdge?.getAttribute("data-executed")).toBe("true");

    // The edge from plan to failure should NOT be highlighted
    const nonExecutedEdge = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="failure"]',
    );
    expect(nonExecutedEdge).not.toBeNull();
    expect(nonExecutedEdge?.getAttribute("data-executed")).toBe("false");
  });

  it("marks terminal node as executed when run is terminal", () => {
    const executions = [
      makeExecution({
        state: "plan",
        transition_decision: JSON.stringify({
          transition: "implement",
          reason: "Plan ready",
          handoff_summary: "Done",
        }),
      }),
      makeExecution({
        state: "implement",
        transition_decision: JSON.stringify({
          transition: "success",
          reason: "Done",
          handoff_summary: "All done",
        }),
      }),
    ];

    const { container } = render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={executions}
        currentState={null}
        status="success"
      />,
    );

    const successNode = container.querySelector('[data-node-id="success"]');
    expect(successNode?.getAttribute("data-executed")).toBe("true");
  });

  it("uses terminal radius for edge endpoints to terminal nodes", () => {
    const { container } = render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={[]}
        currentState={null}
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
    // NODE_WIDTH=140, LAYER_GAP=180, PADDING=40, TERMINAL_RADIUS=22

    // plan(layer0) -> implement(layer1): startX = 40 + 0*180 + 140 = 180, endX = 40 + 1*180 = 220
    // implement(layer1) -> success(layer2): startX = 40 + 1*180 + 140 = 360, endX = 40 + 2*180 + 70 - 22 = 448
    // If bug exists, endX for terminal would be 40 + 2*180 = 400 (using NODE_WIDTH/2=70)
    // After fix, endX for terminal would be 40 + 2*180 + 70 - 22 = 448

    // implement center x = 40 + 1*180 + 70 = 290
    // success center x = 40 + 2*180 + 70 = 470
    // Edge to terminal should end at: 470 - 22 = 448
    expect(terminalEndX).toBe(448);
  });

  it("uses terminal radius for edge start from terminal nodes if applicable", () => {
    // This tests the start offset when source is a terminal (unlikely but defensive)
    // For now, just verify the fix doesn't break normal state->state edges
    const { container } = render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={[]}
        currentState={null}
        status="running"
      />,
    );

    // plan -> implement: startX should use NODE_WIDTH/2 = 70
    const edge = container.querySelector(
      '[data-edge-from="plan"][data-edge-to="implement"] line',
    );
    // plan center x = 40 + 0*180 + 70 = 110
    // startX = 110 + 70 = 180
    expect(Number(edge!.getAttribute("x1"))).toBe(180);
  });

  it("renders edge labels with transition conditions", () => {
    render(
      <WorkflowStateDiagram
        definition={linearWorkflow()}
        stateExecutions={[]}
        currentState={null}
        status="running"
      />,
    );

    expect(screen.getByText("plan is ready")).toBeInTheDocument();
    expect(screen.getByText("planning failed")).toBeInTheDocument();
  });
});
