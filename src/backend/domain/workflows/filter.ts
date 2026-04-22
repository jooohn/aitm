import type {
  ConfigRepository,
  WorkflowDefinition,
} from "@/backend/infra/config";

export function filterWorkflowsForRepository(
  allWorkflows: Record<string, WorkflowDefinition>,
  configRepo: ConfigRepository | undefined,
): Record<string, WorkflowDefinition> {
  if (!configRepo?.workflows) return allWorkflows;

  const allowed = new Set(configRepo.workflows);
  return Object.fromEntries(
    Object.entries(allWorkflows).filter(([name]) => allowed.has(name)),
  );
}
