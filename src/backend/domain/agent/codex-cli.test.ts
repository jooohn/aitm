import { describe, expect, it } from "vitest";
import { buildTransitionOutputFormatForCodex } from "./codex-cli";

describe("buildTransitionOutputFormatForCodex", () => {
  it("restricts transition to the configured state and terminal names", () => {
    const outputFormat = buildTransitionOutputFormatForCodex([
      { step: "plan", when: "needs clarification" },
      { step: "implement", when: "plan is ready" },
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

  it("includes metadata fields as optional properties in the schema", () => {
    const outputFormat = buildTransitionOutputFormatForCodex(
      [{ terminal: "success", when: "done" }],
      {
        pr_url: { type: "string", description: "The pull request URL" },
        pr_number: { type: "string" },
      },
    );

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(properties.pr_url).toEqual({
      type: "string",
      description: "The pull request URL",
    });
    expect(properties.pr_number).toEqual({ type: "string" });

    // Metadata fields should NOT be required
    expect(schema.required).toEqual([
      "transition",
      "reason",
      "handoff_summary",
    ]);
  });

  it("ignores metadata fields that collide with core decision keys", () => {
    const outputFormat = buildTransitionOutputFormatForCodex(
      [{ terminal: "success", when: "done" }],
      {
        transition: { type: "string", description: "collides" },
        reason: { type: "string" },
        pr_url: { type: "string", description: "The pull request URL" },
      },
    );

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    // Core transition field should retain its enum, not be overwritten
    expect(properties.transition).toEqual({
      type: "string",
      enum: ["success"],
    });
    expect(properties.reason).toEqual({ type: "string" });

    // Only pr_url should be added from metadata
    expect(properties.pr_url).toEqual({
      type: "string",
      description: "The pull request URL",
    });
  });

  it("works without metadata (backward compat)", () => {
    const outputFormat = buildTransitionOutputFormatForCodex([
      { terminal: "success", when: "done" },
    ]);

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    // Only the three core fields
    expect(Object.keys(properties)).toEqual([
      "transition",
      "reason",
      "handoff_summary",
    ]);
  });
});
