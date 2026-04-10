import type {
  OutputFormat,
  SessionTransition,
} from "@/backend/domain/agent/runtime";
import type { OutputMetadataFieldDef } from "@/backend/infra/config";

/**
 * Allowlist of built-in tools available to Claude SDK agents.
 * Only tools relevant to autonomous coding tasks in worktrees are enabled.
 */
export const CLAUDE_SDK_TOOLS: string[] = [
  // Core coding tools
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",

  // Sub-agent support
  "Agent",

  // Task tracking
  "TodoWrite",

  // Web access
  "WebFetch",
  "WebSearch",

  // // Interactive — not applicable for headless SDK usage
  // "AskUserQuestion",
  // "EnterPlanMode",
  // "ExitPlanMode",

  "Skill",

  // // Worktree management — aitm manages worktrees externally
  // "EnterWorktree",
  // "ExitWorktree",

  // // Session scheduling — not applicable for managed task runs
  // "CronCreate",
  // "CronDelete",
  // "CronList",

  // // Interactive task UI — headless agents use TodoWrite instead
  // "TaskCreate",
  // "TaskGet",
  // "TaskList",
  // "TaskUpdate",
  // "TaskStop",
  // "TaskOutput",

  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  "ToolSearch",

  // // Jupyter — not applicable
  // "NotebookEdit",

  // // Windows-only
  // "PowerShell",

  "SendMessage",
  "TeamCreate",
  "TeamDelete",

  // Code intelligence — requires plugin setup per worktree
  "LSP",
];

export function buildTransitionOutputFormatForClaude(
  _transitions: SessionTransition[],
  metadataFields?: Record<string, OutputMetadataFieldDef>,
): OutputFormat {
  // claude doesn't support enum, so just use general output format.
  const properties: Record<string, Record<string, unknown>> = {
    transition: { type: "string" },
    reason: { type: "string" },
    handoff_summary: { type: "string" },
    clarifying_question: { type: "string" },
  };

  if (metadataFields) {
    for (const [key, def] of Object.entries(metadataFields)) {
      if (key in properties) continue; // never overwrite core fields
      const prop: Record<string, unknown> = { type: def.type };
      if (def.description) prop.description = def.description;
      properties[key] = prop;
    }
  }

  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties,
      required: Object.keys(properties).filter((k) => k !== "transition"),
      additionalProperties: false,
    },
  };
}
