import { WorkflowTransition } from "@/lib/infra/config";
import { OutputFormat } from "@/lib/utils/agent/runtime";

const TRANSITION_OUTPUT_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      transition: { type: "string" },
      reason: { type: "string" },
      handoff_summary: { type: "string" },
    },
    required: ["transition", "reason", "handoff_summary"],
    additionalProperties: false,
  },
};

export function buildTransitionOutputFormatForClaude(
  transitions: WorkflowTransition[],
): OutputFormat {
  return TRANSITION_OUTPUT_FORMAT;
}
