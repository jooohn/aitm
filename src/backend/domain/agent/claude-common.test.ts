import { describe, expect, it } from "vitest";
import { buildTransitionOutputFormatForClaude } from "./claude-common";

describe("buildTransitionOutputFormatForClaude", () => {
  it("includes metadata fields as required properties in the schema", () => {
    const outputFormat = buildTransitionOutputFormatForClaude(
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

    // Metadata fields should be required alongside core fields
    expect(schema.required).toEqual([
      "transition",
      "reason",
      "handoff_summary",
      "clarifying_question",
      "pr_url",
      "pr_number",
    ]);
  });

  it("includes clarifying_question as an optional property for awaiting-input transitions", () => {
    const outputFormat = buildTransitionOutputFormatForClaude([
      { terminal: "success", when: "done" },
    ]);

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(properties.clarifying_question).toEqual({ type: "string" });
  });

  it("ignores metadata fields that collide with core decision keys", () => {
    const outputFormat = buildTransitionOutputFormatForClaude(
      [{ terminal: "success", when: "done" }],
      {
        transition: { type: "string", description: "collides" },
        reason: { type: "string" },
        handoff_summary: { type: "string" },
        pr_url: { type: "string", description: "The pull request URL" },
      },
    );

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    // Core fields should retain their original definitions (no description from metadata)
    expect(properties.transition).toEqual({ type: "string" });
    expect(properties.reason).toEqual({ type: "string" });
    expect(properties.handoff_summary).toEqual({ type: "string" });
    expect(properties.clarifying_question).toEqual({ type: "string" });

    // Only pr_url should be added from metadata
    expect(properties.pr_url).toEqual({
      type: "string",
      description: "The pull request URL",
    });
  });

  it("works without metadata (backward compat)", () => {
    const outputFormat = buildTransitionOutputFormatForClaude([
      { terminal: "success", when: "done" },
    ]);

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(Object.keys(properties)).toEqual([
      "transition",
      "reason",
      "handoff_summary",
      "clarifying_question",
    ]);
  });
});
