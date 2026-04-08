import type { WorkflowDefinition, WorkflowRunDetail } from "./api";

export interface ResolvedWorkflowSuggestion {
  workflow: string;
  label: string;
  inputValues: Record<string, string>;
}

type SuggestionContext = {
  run: WorkflowRunDetail;
};

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function tokenizeSelector(selector: string): string[] | null {
  if (
    !selector.startsWith("$.") ||
    selector.includes("[") ||
    selector.includes("]")
  ) {
    return null;
  }

  return selector
    .slice(2)
    .split(".")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function evaluateSelector(
  selector: string,
  context: SuggestionContext,
): unknown {
  const tokens = tokenizeSelector(selector);
  if (!tokens) return undefined;

  let current: unknown = context;
  for (const token of tokens) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

export function allRequiredInputsProvided(
  workflow: WorkflowDefinition,
  inputValues: Record<string, string>,
): boolean {
  const inputs = workflow.inputs ?? [];
  return inputs
    .filter((input) => input.required !== false)
    .every((input) => {
      const value = inputValues[input.name];
      return typeof value === "string" && value.trim() !== "";
    });
}

export function resolveWorkflowSuggestions(
  run: WorkflowRunDetail,
  allWorkflows: Record<string, WorkflowDefinition> | null | undefined,
): ResolvedWorkflowSuggestion[] {
  if (!allWorkflows) return [];

  const context: SuggestionContext = { run };

  return Object.entries(allWorkflows)
    .filter(([workflowName]) => workflowName !== run.workflow_name)
    .map(([workflowName, workflow]) => ({
      workflowName,
      rule: workflow.recommended_when,
    }))
    .filter(
      (
        entry,
      ): entry is {
        workflowName: string;
        rule: NonNullable<WorkflowDefinition["recommended_when"]>;
      } => entry.rule !== undefined,
    )
    .filter((entry) =>
      hasValue(evaluateSelector(entry.rule.condition, context)),
    )
    .map(({ workflowName, rule }) => ({
      workflow: workflowName,
      label: allWorkflows[workflowName]?.label ?? workflowName,
      inputValues: Object.fromEntries(
        Object.entries(rule.inputs ?? {})
          .map(([name, selector]) => [
            name,
            evaluateSelector(selector, context),
          ])
          .filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
      ),
    }));
}
