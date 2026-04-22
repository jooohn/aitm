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
const CORNER_RADIUS = 8;
const BACK_EDGE_LANE_GAP = 20;
const SAME_LAYER_BACK_OFFSET = 20;
const ADJACENT_SIDE_OFFSET = 12;

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

  // Build a set of steps that transitioned to "success" (terminal successful steps)
  const terminalSuccessSteps = new Set(
    stepExecutions
      .filter((e) => e.transition_decision?.transition === "success")
      .map((e) => e.step),
  );

  // Pre-compute back-edge lanes for same-row cross-layer back edges (⊓-shape above)
  const crossLayerBackEdges: Array<{
    edgeIndex: number;
    span: number;
  }> = [];
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fp = layout.get(edge.from);
    const tp = layout.get(edge.to);
    if (fp && tp && fp.layer > tp.layer && fp.index === tp.index) {
      crossLayerBackEdges.push({
        edgeIndex: i,
        span: fp.layer - tp.layer,
      });
    }
  }
  // Shorter spans get closer lanes to avoid crossing longer-span edges
  crossLayerBackEdges.sort((a, b) => a.span - b.span);
  const backEdgeLaneMap = new Map<number, number>();
  for (let i = 0; i < crossLayerBackEdges.length; i++) {
    backEdgeLaneMap.set(crossLayerBackEdges[i].edgeIndex, i);
  }

  // Compute SVG dimensions
  const maxLayer = Math.max(...Array.from(layout.values()).map((p) => p.layer));
  const maxIndex = Math.max(...Array.from(layout.values()).map((p) => p.index));
  const svgWidth = (maxLayer + 1) * LAYER_GAP + PADDING * 2;
  const baseHeight = (maxIndex + 1) * ROW_GAP + PADDING * 2;

  const numLanes = crossLayerBackEdges.length;
  const maxAboveOffset =
    numLanes > 0 ? NODE_HEIGHT / 2 + BACK_EDGE_LANE_GAP * (numLanes + 0.5) : 0;
  const topPadding = PADDING + maxAboveOffset;
  const svgHeight = baseHeight + maxAboveOffset;

  function nodeCenter(nodeId: string): { x: number; y: number } {
    const pos = layout.get(nodeId);
    if (!pos) return { x: 0, y: 0 };
    return {
      x: PADDING + pos.layer * LAYER_GAP + NODE_WIDTH / 2,
      y: topPadding + pos.index * ROW_GAP + NODE_HEIGHT / 2,
    };
  }

  // Compute port offsets so edges sharing the same node border are spaced apart
  type Side = "top" | "right" | "bottom" | "left";
  interface PortEntry {
    edgeIndex: number;
    otherNodeId: string;
    end: "from" | "to";
  }
  const portMap = new Map<string, PortEntry[]>();
  function addPort(nodeId: string, side: Side, entry: PortEntry) {
    const key = `${nodeId}:${side}`;
    const list = portMap.get(key) ?? [];
    list.push(entry);
    portMap.set(key, list);
  }
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fp = layout.get(edge.from);
    const tp = layout.get(edge.to);
    if (!fp || !tp) continue;
    const fc = nodeCenter(edge.from);
    const tc = nodeCenter(edge.to);
    const isBackEdge = fp.layer >= tp.layer;
    const differentRow = fc.y !== tc.y;
    const sameColumn = fp.layer === tp.layer;
    const adjacent = sameColumn && Math.abs(fp.index - tp.index) === 1;
    if (isBackEdge && adjacent) {
      // Same-column adjacent: ⊃-shape via right sides
      addPort(edge.from, "right", {
        edgeIndex: i,
        otherNodeId: edge.to,
        end: "from",
      });
      addPort(edge.to, "right", {
        edgeIndex: i,
        otherNodeId: edge.from,
        end: "to",
      });
    } else if (isBackEdge && differentRow) {
      // Back edge between different rows: ⊂-shape via left sides
      addPort(edge.from, "left", {
        edgeIndex: i,
        otherNodeId: edge.to,
        end: "from",
      });
      addPort(edge.to, "left", {
        edgeIndex: i,
        otherNodeId: edge.from,
        end: "to",
      });
    } else if (fp.layer > tp.layer) {
      // Back edge on same row: ⊓-shape via top sides
      addPort(edge.from, "top", {
        edgeIndex: i,
        otherNodeId: edge.to,
        end: "from",
      });
      addPort(edge.to, "top", {
        edgeIndex: i,
        otherNodeId: edge.from,
        end: "to",
      });
    } else {
      addPort(edge.from, "right", {
        edgeIndex: i,
        otherNodeId: edge.to,
        end: "from",
      });
      addPort(edge.to, "left", {
        edgeIndex: i,
        otherNodeId: edge.from,
        end: "to",
      });
    }
  }
  const PORT_SPACING = 12;
  const portOffsets = new Map<string, { dx: number; dy: number }>();
  for (const [key, entries] of portMap) {
    if (entries.length <= 1) {
      portOffsets.set(`${entries[0].edgeIndex}:${entries[0].end}`, {
        dx: 0,
        dy: 0,
      });
      continue;
    }
    const side = key.split(":")[1] as Side;
    const isHorizontal = side === "top" || side === "bottom";
    // For top/bottom: sort X descending so outer (farther) edges get left offsets,
    // preventing descent verticals from crossing inner horizontals
    entries.sort((a, b) => {
      const ac = nodeCenter(a.otherNodeId);
      const bc = nodeCenter(b.otherNodeId);
      return isHorizontal ? bc.x - ac.x : ac.y - bc.y;
    });
    for (let i = 0; i < entries.length; i++) {
      const offset = (i - (entries.length - 1) / 2) * PORT_SPACING;
      portOffsets.set(`${entries[i].edgeIndex}:${entries[i].end}`, {
        dx: isHorizontal ? offset : 0,
        dy: isHorizontal ? 0 : offset,
      });
    }
  }
  function getPortOffset(edgeIndex: number, end: "from" | "to") {
    return portOffsets.get(`${edgeIndex}:${end}`) ?? { dx: 0, dy: 0 };
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
          const edgeClass = isExecuted ? styles.edgeExecuted : styles.edge;
          const markerEnd = isExecuted
            ? "url(#arrowhead-executed)"
            : "url(#arrowhead)";

          const fromPos = layout.get(edge.from);
          const toPos = layout.get(edge.to);
          if (!fromPos || !toPos) return null;

          const R = CORNER_RADIUS;

          const edgeDataProps = {
            "data-edge-from": edge.from,
            "data-edge-to": edge.to,
            "data-executed": isExecuted ? "true" : "false",
          };

          const fromPort = getPortOffset(edgeIndex, "from");
          const toPort = getPortOffset(edgeIndex, "to");

          const isBackEdge = fromPos.layer >= toPos.layer;
          const differentRow = Math.abs(from.y - to.y) >= 1;
          const sameColumn = fromPos.layer === toPos.layer;
          const adjacent =
            sameColumn && Math.abs(fromPos.index - toPos.index) === 1;

          // Same-column adjacent back edge: ⊃-shape via the right side
          if (isBackEdge && adjacent) {
            const exitX = from.x + NODE_WIDTH / 2;
            const enterX = to.x + NODE_WIDTH / 2;
            const startY = from.y + fromPort.dy;
            const endY = to.y + toPort.dy;
            const sideX = Math.max(exitX, enterX) + ADJACENT_SIDE_OFFSET;
            const goingUp = endY < startY;
            const d = [
              `M ${exitX} ${startY}`,
              `L ${sideX - R} ${startY}`,
              `Q ${sideX} ${startY} ${sideX} ${startY + (goingUp ? -R : R)}`,
              `L ${sideX} ${endY + (goingUp ? R : -R)}`,
              `Q ${sideX} ${endY} ${sideX - R} ${endY}`,
              `L ${enterX} ${endY}`,
            ].join(" ");
            return (
              <g key={edgeKey} {...edgeDataProps}>
                <path d={d} className={edgeClass} markerEnd={markerEnd} />
              </g>
            );
          }

          // Back edge between different rows (non-adjacent): ⊂-shape routing to the left
          if (isBackEdge && differentRow) {
            const exitX = from.x - NODE_WIDTH / 2;
            const enterX = to.x - NODE_WIDTH / 2;
            const startY = from.y + fromPort.dy;
            const endY = to.y + toPort.dy;
            const sideX = Math.min(exitX, enterX) - SAME_LAYER_BACK_OFFSET;
            const goingUp = endY < startY;
            const d = [
              `M ${exitX} ${startY}`,
              `L ${sideX + R} ${startY}`,
              `Q ${sideX} ${startY} ${sideX} ${startY + (goingUp ? -R : R)}`,
              `L ${sideX} ${endY + (goingUp ? R : -R)}`,
              `Q ${sideX} ${endY} ${sideX + R} ${endY}`,
              `L ${enterX} ${endY}`,
            ].join(" ");
            return (
              <g key={edgeKey} {...edgeDataProps}>
                <path d={d} className={edgeClass} markerEnd={markerEnd} />
              </g>
            );
          }

          // Same-row cross-layer back edge: ⊓-shape routing above
          if (fromPos.layer > toPos.layer) {
            const laneIdx = backEdgeLaneMap.get(edgeIndex) ?? 0;
            const laneY =
              topPadding - NODE_HEIGHT / 2 - BACK_EDGE_LANE_GAP * (laneIdx + 1);
            const startX = from.x + fromPort.dx;
            const startY = from.y - NODE_HEIGHT / 2;
            const endX = to.x + toPort.dx;
            const endY = to.y - NODE_HEIGHT / 2;
            const d = [
              `M ${startX} ${startY}`,
              `L ${startX} ${laneY + R}`,
              `Q ${startX} ${laneY} ${startX - R} ${laneY}`,
              `L ${endX + R} ${laneY}`,
              `Q ${endX} ${laneY} ${endX} ${laneY + R}`,
              `L ${endX} ${endY}`,
            ].join(" ");
            return (
              <g key={edgeKey} {...edgeDataProps}>
                <path d={d} className={edgeClass} markerEnd={markerEnd} />
              </g>
            );
          }

          // Forward edge: compute border offsets
          const startX = from.x + NODE_WIDTH / 2;
          const startY = from.y + fromPort.dy;
          const endX = to.x - NODE_WIDTH / 2;
          const endY = to.y + toPort.dy;

          // Forward edge: orthogonal routing
          if (Math.abs(startY - endY) < 1) {
            // Same height: straight horizontal line
            return (
              <g key={edgeKey} {...edgeDataProps}>
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  className={edgeClass}
                  markerEnd={markerEnd}
                />
              </g>
            );
          }

          // Different height: orthogonal Z-shape with rounded corners
          const midX = (startX + endX) / 2;
          const goingDown = endY > startY;
          // Clamp radius so the two corners don't overlap
          const rZ = Math.min(R, Math.abs(endY - startY) / 2);
          const d = [
            `M ${startX} ${startY}`,
            `L ${midX - rZ} ${startY}`,
            `Q ${midX} ${startY} ${midX} ${startY + (goingDown ? rZ : -rZ)}`,
            `L ${midX} ${endY + (goingDown ? -rZ : rZ)}`,
            `Q ${midX} ${endY} ${midX + rZ} ${endY}`,
            `L ${endX} ${endY}`,
          ].join(" ");
          return (
            <g key={edgeKey} {...edgeDataProps}>
              <path d={d} className={edgeClass} markerEnd={markerEnd} />
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
                : nodeStatus === "success" &&
                    terminalSuccessSteps.has(node.id) &&
                    status === "success"
                  ? styles.nodeSuccess
                  : nodeStatus === "success"
                    ? styles.nodeExecuted
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
