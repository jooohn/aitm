import type { WorkflowDefinition } from "./api";

/**
 * Returns workflow step names in topological order via BFS from the initial step.
 * Terminal transitions (success/failure) are excluded from the result.
 */
export function getOrderedSteps(definition: WorkflowDefinition): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [definition.initial_step];
  visited.add(definition.initial_step);

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);

    const step = definition.steps[current];
    if (!step) continue;

    for (const transition of step.transitions) {
      if (transition.step && !visited.has(transition.step)) {
        visited.add(transition.step);
        queue.push(transition.step);
      }
    }
  }

  return ordered;
}
