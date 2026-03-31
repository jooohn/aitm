import { describe, expect, it } from "vitest";
import { buildTransitionOutputFormat } from "./index";

describe("buildTransitionOutputFormat", () => {
  it("restricts transition to the configured state and terminal names", () => {
    const outputFormat = buildTransitionOutputFormat([
      { state: "plan", when: "needs clarification" },
      { state: "implement", when: "plan is ready" },
      { terminal: "failure", when: "blocked" },
    ]);

    expect(outputFormat).toEqual({
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          transition: {
            type: "string",
            enum: ["plan", "implement", "failure"],
          },
          reason: { type: "string" },
          handoff_summary: { type: "string" },
        },
        required: ["transition", "reason", "handoff_summary"],
        additionalProperties: false,
      },
    });
  });
});
