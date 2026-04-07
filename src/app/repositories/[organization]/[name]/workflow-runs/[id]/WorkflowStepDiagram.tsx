"use client";

import type {
  StepExecution,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "@/lib/utils/api";
import styles from "./WorkflowStepDiagram.module.css";
import { buildGraph, computeLayout } from "./workflowGraph";

interface Props {
  definition: WorkflowDefinition;
  stepExecutions: StepExecution[];
  currentStep: string | null;
  status: WorkflowRunStatus;
  onStepClick?: (stepId: string) => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 44;
const LAYER_GAP = 180;
const ROW_GAP = 64;
const PADDING = 24;
const TERMINAL_RADIUS = 30;

function parseTransitionTarget(execution: StepExecution): string | null {
  return execution.transition_decision?.transition ?? null;
}

export default function WorkflowStepDiagram({
  definition,
  stepExecutions,
  currentStep,
  status,
  onStepClick,
}: Props) {
  const graph = buildGraph(definition);
  const layout = computeLayout(graph);

  // Build a lookup for node types
  const nodeTypeMap = new Map(graph.nodes.map((n) => [n.id, n.type]));

  // Determine which steps have been executed
  const executedSteps = new Set(stepExecutions.map((e) => e.step));

  // Build a map from step name to the latest execution's status
  const stepStatusMap = new Map<string, StepExecution["status"]>();
  for (const execution of stepExecutions) {
    stepStatusMap.set(execution.step, execution.status);
  }

  // Determine executed edges: step -> transition target
  const executedEdges = new Set<string>();
  for (const execution of stepExecutions) {
    const target = parseTransitionTarget(execution);
    if (target) {
      executedEdges.add(`${execution.step}->${target}`);
    }
  }

  // Check if success terminal node was reached
  if (status === "success") {
    executedSteps.add("success");
  }

  // Compute SVG dimensions
  const maxLayer = Math.max(...Array.from(layout.values()).map((p) => p.layer));
  const maxIndex = Math.max(...Array.from(layout.values()).map((p) => p.index));
  const svgWidth = (maxLayer + 1) * LAYER_GAP + PADDING * 2;
  const baseHeight = (maxIndex + 1) * ROW_GAP + PADDING * 2;

  // Compute extra height needed for back-edge curves that extend below the base
  let maxBelowY = 0;
  for (const edge of graph.edges) {
    const fromPos = layout.get(edge.from);
    const toPos = layout.get(edge.to);
    if (fromPos && toPos && fromPos.layer >= toPos.layer) {
      const fromCenterY = PADDING + fromPos.index * ROW_GAP + NODE_HEIGHT / 2;
      const toCenterY = PADDING + toPos.index * ROW_GAP + NODE_HEIGHT / 2;
      const belowY =
        Math.max(fromCenterY, toCenterY) + NODE_HEIGHT / 2 + ROW_GAP * 0.6;
      maxBelowY = Math.max(maxBelowY, belowY);
    }
  }
  const svgHeight = Math.max(baseHeight, maxBelowY + PADDING);

  function nodeCenter(nodeId: string): { x: number; y: number } {
    const pos = layout.get(nodeId);
    if (!pos) return { x: 0, y: 0 };
    return {
      x: PADDING + pos.layer * LAYER_GAP + NODE_WIDTH / 2,
      y: PADDING + pos.index * ROW_GAP + NODE_HEIGHT / 2,
    };
  }

  return (
    <div className={styles.container}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className={styles.svg}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className={styles.arrowhead} />
          </marker>
          <marker
            id="arrowhead-executed"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              className={styles.arrowheadExecuted}
            />
          </marker>
        </defs>

        {/* Edges */}
        {graph.edges.map((edge, edgeIndex) => {
          const from = nodeCenter(edge.from);
          const to = nodeCenter(edge.to);
          const edgeKey = `${edge.from}->${edge.to}:${edgeIndex}`;
          const executionKey = `${edge.from}->${edge.to}`;
          const isExecuted = executedEdges.has(executionKey);

          const fromPos = layout.get(edge.from);
          const toPos = layout.get(edge.to);
          const isBackEdge = fromPos && toPos && fromPos.layer >= toPos.layer;

          // Offset start/end to node borders (use terminal radius for circle nodes)
          const fromOffset =
            nodeTypeMap.get(edge.from) === "terminal"
              ? TERMINAL_RADIUS
              : NODE_WIDTH / 2;
          const toOffset =
            nodeTypeMap.get(edge.to) === "terminal"
              ? TERMINAL_RADIUS
              : NODE_WIDTH / 2;

          if (isBackEdge) {
            // Back-edge: curved path going below the nodes
            const startX = from.x - fromOffset;
            const endX = to.x + toOffset;
            const belowY =
              Math.max(from.y, to.y) + NODE_HEIGHT / 2 + ROW_GAP * 0.6;
            const d = `M ${startX} ${from.y} C ${startX - LAYER_GAP * 0.3} ${belowY}, ${endX + LAYER_GAP * 0.3} ${belowY}, ${endX} ${to.y}`;
            return (
              <g
                key={edgeKey}
                data-edge-from={edge.from}
                data-edge-to={edge.to}
                data-executed={isExecuted ? "true" : "false"}
              >
                <path
                  d={d}
                  className={isExecuted ? styles.edgeExecuted : styles.edge}
                  markerEnd={
                    isExecuted ? "url(#arrowhead-executed)" : "url(#arrowhead)"
                  }
                />
              </g>
            );
          }

          const startX = from.x + fromOffset;
          const endX = to.x - toOffset;

          return (
            <g
              key={edgeKey}
              data-edge-from={edge.from}
              data-edge-to={edge.to}
              data-executed={isExecuted ? "true" : "false"}
            >
              <line
                x1={startX}
                y1={from.y}
                x2={endX}
                y2={to.y}
                className={isExecuted ? styles.edgeExecuted : styles.edge}
                markerEnd={
                  isExecuted ? "url(#arrowhead-executed)" : "url(#arrowhead)"
                }
              />
            </g>
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const pos = layout.get(node.id);
          if (!pos) return null;
          const center = nodeCenter(node.id);
          const isExecuted = executedSteps.has(node.id);
          const isCurrent = currentStep === node.id;

          if (node.type === "terminal") {
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                data-executed={isExecuted ? "true" : "false"}
                data-current="false"
              >
                <circle
                  cx={center.x}
                  cy={center.y}
                  r={TERMINAL_RADIUS}
                  className={`${styles.terminalNode} ${
                    node.terminal === "success"
                      ? styles.terminalSuccess
                      : styles.terminalFailure
                  } ${isExecuted ? styles.nodeExecuted : ""}`}
                />
                <text
                  x={center.x}
                  y={center.y + 5}
                  textAnchor="middle"
                  className={styles.terminalLabel}
                >
                  {node.terminal === "success" ? "Success" : "Failure"}
                </text>
              </g>
            );
          }

          const x = center.x - NODE_WIDTH / 2;
          const y = center.y - NODE_HEIGHT / 2;
          const isFailed = status === "failure" && currentStep === node.id;
          const isClickable =
            onStepClick && (isExecuted || isCurrent || isFailed);
          const nodeStatus = stepStatusMap.get(node.id);

          // Determine the status-based CSS class for the node
          const nodeStatusClass =
            isFailed || nodeStatus === "failure"
              ? styles.nodeFailure
              : nodeStatus === "awaiting"
                ? styles.nodeAwaiting
                : nodeStatus === "success"
                  ? styles.nodeSuccess
                  : isCurrent
                    ? styles.nodeCurrent
                    : isExecuted
                      ? styles.nodeExecuted
                      : styles.nodeDimmed;

          const nodeStatusAttr: Record<string, string> = {};
          if (nodeStatus) {
            nodeStatusAttr["data-node-status"] = nodeStatus;
          }

          return (
            <g
              key={node.id}
              data-node-id={node.id}
              data-executed={isExecuted ? "true" : "false"}
              data-current={isCurrent ? "true" : "false"}
              data-failed={isFailed ? "true" : "false"}
              {...nodeStatusAttr}
              className={isClickable ? styles.clickable : undefined}
              onClick={isClickable ? () => onStepClick(node.id) : undefined}
            >
              <rect
                x={x}
                y={y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                ry={8}
                className={`${styles.stateNode} ${nodeStatusClass}`}
              />
              <text
                x={center.x}
                y={center.y + 5}
                textAnchor="middle"
                className={styles.stateLabel}
              >
                {node.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
