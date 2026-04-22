import type { WorkflowDefinition } from "@/lib/utils/api";

export interface GraphNode {
  id: string;
  type: "step";
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
  const edgeKeys = new Set<string>();

  function addEdge(from: string, to: string, label: string) {
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, label });
  }

  for (const [stateName, state] of Object.entries(definition.steps)) {
    nodes.set(stateName, { id: stateName, type: "step" });

    for (const transition of state.transitions) {
      if ("step" in transition) {
        addEdge(stateName, transition.step, transition.when);
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

  // BFS with first-visit-wins (min-layer).
  // This prevents cycles from pushing all nodes to the max layer.
  const queue: Array<{ id: string; layer: number }> = [
    { id: graph.initialStep, layer: 0 },
  ];
  layers.set(graph.initialStep, 0);

  while (queue.length > 0) {
    const { id, layer } = queue.shift()!;
    const targets = adjacency.get(id) ?? [];
    for (const target of targets) {
      if (!layers.has(target)) {
        layers.set(target, layer + 1);
        queue.push({ id: target, layer: layer + 1 });
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
