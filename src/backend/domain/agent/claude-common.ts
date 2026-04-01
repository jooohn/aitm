import {
  OutputFormat,
  SessionTransition,
} from "@/backend/domain/agent/runtime";

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
  _transitions: SessionTransition[],
): OutputFormat {
  // claude doesn't support enum, so just use general output format.
  return TRANSITION_OUTPUT_FORMAT;
}
