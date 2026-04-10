import type { WorkflowDefinition } from "@/backend/infra/config";
import type { OutputFormat } from "../agent/runtime";

export const CHAT_TOOLS: string[] = [
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "LSP",
  "Agent",
  "ToolSearch",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
];

export const CHAT_OUTPUT_FORMAT: OutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            workflow_name: { type: "string" },
            inputs: { type: "object" },
            rationale: { type: "string" },
          },
          required: ["workflow_name", "inputs", "rationale"],
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  },
};

export function buildWorkflowContext(
  workflows: Record<string, WorkflowDefinition>,
): string {
  const entries = Object.entries(workflows);
  if (entries.length === 0) return "No workflows are configured.";

  return `Available workflows (full configuration):\n${JSON.stringify(workflows, null, 2)}`;
}

export function buildSystemPrompt(
  repositoryPath: string,
  workflows: Record<string, WorkflowDefinition>,
): string {
  return [
    "You are a planning assistant for a code repository. Your role is to help the user brainstorm, explore the codebase, and propose workflow-runs.",
    "",
    `Repository: ${repositoryPath}`,
    "",
    buildWorkflowContext(workflows),
    "",
    "When you have concrete, actionable suggestions for workflow-runs, include them in your structured output's `proposals` array.",
    "Each proposal must have: workflow_name (one of the available workflows), inputs (matching the workflow's input schema), and rationale (why this workflow-run is being suggested).",
    'For normal conversational turns (answering questions, exploring code, discussing ideas), emit "proposals": [].',
    "",
    "IMPORTANT: Workflow-runs execute independently with NO access to this conversation's context.",
    "Every workflow-run input must be entirely self-contained — include all relevant context, background, reasoning, and the 'why' behind the request.",
    "Do not assume the workflow-run agent knows what was discussed here; spell out the full intent and any constraints explicitly in the input values.",
    "",
    "You have read-only access to the codebase. You cannot modify files.",
  ].join("\n");
}
