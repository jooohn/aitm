"use client";

import type {
  StateExecution,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "@/lib/utils/api";
import styles from "./WorkflowStateDiagram.module.css";
import { buildGraph, computeLayout } from "./workflowGraph";

interface Props {
  definition: WorkflowDefinition;
  stateExecutions: StateExecution[];
  currentState: string | null;
  status: WorkflowRunStatus;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 44;
const LAYER_GAP = 180;
const ROW_GAP = 80;
const PADDING = 40;
const TERMINAL_RADIUS = 22;

function parseTransitionTarget(execution: StateExecution): string | null {
  if (!execution.transition_decision) return null;
  try {
    const decision = JSON.parse(execution.transition_decision);
    return decision.transition ?? null;
  } catch {
    return null;
  }
}

export default function WorkflowStateDiagram({
  definition,
  stateExecutions,
  currentState,
  status,
}: Props) {
  const graph = buildGraph(definition);
  const layout = computeLayout(graph);

  // Build a lookup for node types
  const nodeTypeMap = new Map(graph.nodes.map((n) => [n.id, n.type]));

  // Determine which states have been executed
  const executedStates = new Set(stateExecutions.map((e) => e.state));

  // Determine executed edges: state -> transition target
  const executedEdges = new Set<string>();
  for (const execution of stateExecutions) {
    const target = parseTransitionTarget(execution);
    if (target) {
      executedEdges.add(`${execution.state}->${target}`);
    }
  }

  // Check if terminal node was reached
  const isTerminal = status === "success" || status === "failure";
  if (isTerminal) {
    executedStates.add(status);
  }

  // Check if there are back-edges (cycles) that need extra vertical space
  const hasBackEdges = graph.edges.some((edge) => {
    const fromPos = layout.get(edge.from);
    const toPos = layout.get(edge.to);
    return fromPos && toPos && fromPos.layer >= toPos.layer;
  });

  // Compute SVG dimensions
  const maxLayer = Math.max(...Array.from(layout.values()).map((p) => p.layer));
  const maxIndex = Math.max(...Array.from(layout.values()).map((p) => p.index));
  const svgWidth = (maxLayer + 1) * LAYER_GAP + PADDING * 2;
  const backEdgeExtra = hasBackEdges ? ROW_GAP * 0.6 + PADDING : 0;
  const svgHeight = (maxIndex + 1) * ROW_GAP + PADDING * 2 + backEdgeExtra;

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
            const midX = (startX + endX) / 2;
            const labelY = belowY + 4;

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
                <text
                  x={midX}
                  y={labelY}
                  textAnchor="middle"
                  className={styles.edgeLabel}
                >
                  {edge.label}
                </text>
              </g>
            );
          }

          const startX = from.x + fromOffset;
          const endX = to.x - toOffset;

          // Compute label position at midpoint
          const midX = (startX + endX) / 2;
          const midY = (from.y + to.y) / 2;

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
              <text
                x={midX}
                y={midY - 8}
                textAnchor="middle"
                className={styles.edgeLabel}
              >
                {edge.label}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const pos = layout.get(node.id);
          if (!pos) return null;
          const center = nodeCenter(node.id);
          const isExecuted = executedStates.has(node.id);
          const isCurrent = currentState === node.id;

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

          return (
            <g
              key={node.id}
              data-node-id={node.id}
              data-executed={isExecuted ? "true" : "false"}
              data-current={isCurrent ? "true" : "false"}
            >
              <rect
                x={x}
                y={y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                ry={8}
                className={`${styles.stateNode} ${
                  isCurrent ? styles.nodeCurrent : ""
                } ${isExecuted ? styles.nodeExecuted : ""} ${
                  !isExecuted && !isCurrent ? styles.nodeDimmed : ""
                }`}
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
