import type { WorkflowDefinition } from "@/lib/utils/api";

export interface GraphNode {
  id: string;
  type: "step" | "terminal";
  terminal?: "success" | "failure";
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  initialStep: string;
}

export interface NodePosition {
  layer: number;
  index: number;
}

export function buildGraph(definition: WorkflowDefinition): Graph {
  const nodes: Map<string, GraphNode> = new Map();
  const edges: GraphEdge[] = [];

  for (const [stateName, state] of Object.entries(definition.steps)) {
    nodes.set(stateName, { id: stateName, type: "step" });

    for (const transition of state.transitions) {
      if (transition.step) {
        edges.push({
          from: stateName,
          to: transition.step,
          label: transition.when,
        });
      } else if (transition.terminal && transition.terminal !== "failure") {
        if (!nodes.has(transition.terminal)) {
          nodes.set(transition.terminal, {
            id: transition.terminal,
            type: "terminal",
            terminal: transition.terminal,
          });
        }
        edges.push({
          from: stateName,
          to: transition.terminal,
          label: transition.when,
        });
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    initialStep: definition.initial_step,
  };
}

export function computeLayout(graph: Graph): Map<string, NodePosition> {
  const layers = new Map<string, number>();

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const terminalIds = new Set(
    graph.nodes.filter((n) => n.type === "terminal").map((n) => n.id),
  );

  // BFS with first-visit-wins (min-layer) for non-terminal nodes.
  // This prevents cycles from pushing all nodes to the max layer.
  const queue: Array<{ id: string; layer: number }> = [
    { id: graph.initialStep, layer: 0 },
  ];
  layers.set(graph.initialStep, 0);

  while (queue.length > 0) {
    const { id, layer } = queue.shift()!;
    const targets = adjacency.get(id) ?? [];
    for (const target of targets) {
      if (terminalIds.has(target)) {
        // Terminal nodes use max-layer: placed after their latest predecessor
        const currentLayer = layers.get(target) ?? -1;
        if (layer + 1 > currentLayer) {
          layers.set(target, layer + 1);
          queue.push({ id: target, layer: layer + 1 });
        }
      } else {
        // Non-terminal nodes use first-visit-wins (min-layer)
        if (!layers.has(target)) {
          layers.set(target, layer + 1);
          queue.push({ id: target, layer: layer + 1 });
        }
      }
    }
  }

  // Group nodes by layer and assign index within each layer
  const layerGroups = new Map<number, string[]>();
  for (const [nodeId, layer] of layers.entries()) {
    const group = layerGroups.get(layer) ?? [];
    group.push(nodeId);
    layerGroups.set(layer, group);
  }

  const result = new Map<string, NodePosition>();
  for (const [layer, nodeIds] of layerGroups.entries()) {
    // Sort for deterministic ordering
    nodeIds.sort();
    for (let i = 0; i < nodeIds.length; i++) {
      result.set(nodeIds[i], { layer, index: i });
    }
  }

  return result;
}
