import type {
  OutputFormat,
  SessionTransition,
} from "@/backend/domain/agent/runtime";
import type { OutputMetadataFieldDef } from "@/backend/infra/config";

export function buildTransitionOutputFormatForClaude(
  _transitions: SessionTransition[],
  metadataFields?: Record<string, OutputMetadataFieldDef>,
): OutputFormat {
  // claude doesn't support enum, so just use general output format.
  const properties: Record<string, Record<string, unknown>> = {
    transition: { type: "string" },
    reason: { type: "string" },
    handoff_summary: { type: "string" },
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
      required: ["transition", "reason", "handoff_summary"],
      additionalProperties: false,
    },
  };
}
