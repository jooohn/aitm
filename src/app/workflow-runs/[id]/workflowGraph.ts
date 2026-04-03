import type { WorkflowDefinition } from "@/lib/utils/api";

export interface GraphNode {
  id: string;
  type: "state" | "terminal";
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
  initialState: string;
}

export interface NodePosition {
  layer: number;
  index: number;
}

export function buildGraph(definition: WorkflowDefinition): Graph {
  const nodes: Map<string, GraphNode> = new Map();
  const edges: GraphEdge[] = [];

  for (const [stateName, state] of Object.entries(definition.states)) {
    nodes.set(stateName, { id: stateName, type: "state" });

    for (const transition of state.transitions) {
      if (transition.state) {
        edges.push({
          from: stateName,
          to: transition.state,
          label: transition.when,
        });
      } else if (transition.terminal) {
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
    initialState: definition.initial_state,
  };
}

export function computeLayout(graph: Graph): Map<string, NodePosition> {
  const layers = new Map<string, number>();

  // BFS from initial state to assign layers (max distance from root)
  // Use iterative relaxation to handle converging paths
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  // Initialize all nodes with -1
  for (const node of graph.nodes) {
    layers.set(node.id, -1);
  }

  // BFS with max-layer assignment (ensures converging nodes get the max layer)
  // Cap layers at node count to prevent infinite loops on cyclic graphs
  const maxLayer = graph.nodes.length - 1;
  const queue: Array<{ id: string; layer: number }> = [
    { id: graph.initialState, layer: 0 },
  ];
  layers.set(graph.initialState, 0);

  while (queue.length > 0) {
    const { id, layer } = queue.shift()!;
    const targets = adjacency.get(id) ?? [];
    for (const target of targets) {
      const currentLayer = layers.get(target) ?? -1;
      const newLayer = Math.min(layer + 1, maxLayer);
      if (newLayer > currentLayer) {
        layers.set(target, newLayer);
        queue.push({ id: target, layer: newLayer });
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
