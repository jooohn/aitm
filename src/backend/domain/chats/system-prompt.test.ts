import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@/backend/infra/config";
import {
  buildSystemPrompt,
  buildWorkflowContext,
  CHAT_OUTPUT_FORMAT,
  CHAT_TOOLS,
} from "./system-prompt";

describe("system-prompt", () => {
  describe("CHAT_TOOLS", () => {
    it("is a non-empty array of strings", () => {
      expect(CHAT_TOOLS.length).toBeGreaterThan(0);
      for (const tool of CHAT_TOOLS) {
        expect(typeof tool).toBe("string");
      }
    });

    it("includes read-only tools", () => {
      expect(CHAT_TOOLS).toContain("Read");
      expect(CHAT_TOOLS).toContain("Glob");
      expect(CHAT_TOOLS).toContain("Grep");
    });
  });

  describe("CHAT_OUTPUT_FORMAT", () => {
    it("has type json_schema", () => {
      expect(CHAT_OUTPUT_FORMAT.type).toBe("json_schema");
    });

    it("schema requires a proposals array", () => {
      const schema = CHAT_OUTPUT_FORMAT.schema;
      expect(schema.required).toContain("proposals");
    });

    it("disallows unknown fields on proposal items for Codex schema validation", () => {
      const schema = CHAT_OUTPUT_FORMAT.schema as {
        properties: {
          proposals: {
            items: { additionalProperties?: boolean };
          };
        };
      };

      expect(schema.properties.proposals.items.additionalProperties).toBe(
        false,
      );
    });
  });

  describe("buildWorkflowContext", () => {
    it("returns fallback text when no workflows are configured", () => {
      const result = buildWorkflowContext({});
      expect(result).toBe("No workflows are configured.");
    });

    it("includes workflow configuration for a single workflow", () => {
      const workflows: Record<string, WorkflowDefinition> = {
        "dev-flow": {
          initial_step: "plan",
          steps: {
            plan: {
              type: "agent",
              goal: "Plan the work",
              transitions: [{ terminal: "success" as const, when: "done" }],
            },
          },
        },
      };
      const result = buildWorkflowContext(workflows);
      expect(result).toContain("Available workflows");
      expect(result).toContain("dev-flow");
      expect(result).toContain("Plan the work");
    });

    it("includes all workflows when multiple are configured", () => {
      const workflows: Record<string, WorkflowDefinition> = {
        "dev-flow": {
          initial_step: "plan",
          steps: {
            plan: {
              type: "agent",
              goal: "Plan",
              transitions: [{ terminal: "success" as const, when: "done" }],
            },
          },
        },
        "bugfix-flow": {
          initial_step: "fix",
          steps: {
            fix: {
              type: "agent",
              goal: "Fix bug",
              transitions: [{ terminal: "success" as const, when: "done" }],
            },
          },
        },
      };
      const result = buildWorkflowContext(workflows);
      expect(result).toContain("dev-flow");
      expect(result).toContain("bugfix-flow");
    });
  });

  describe("buildSystemPrompt", () => {
    it("includes the repository path", () => {
      const result = buildSystemPrompt("/home/user/repo", {});
      expect(result).toContain("/home/user/repo");
    });

    it("includes the planning assistant role", () => {
      const result = buildSystemPrompt("/repo", {});
      expect(result).toContain("planning assistant");
    });

    it("includes workflow context", () => {
      const workflows: Record<string, WorkflowDefinition> = {
        "dev-flow": {
          initial_step: "plan",
          steps: {
            plan: {
              type: "agent",
              goal: "Plan",
              transitions: [{ terminal: "success" as const, when: "done" }],
            },
          },
        },
      };
      const result = buildSystemPrompt("/repo", workflows);
      expect(result).toContain("dev-flow");
    });

    it("mentions read-only access", () => {
      const result = buildSystemPrompt("/repo", {});
      expect(result).toContain("read-only");
    });

    it("mentions self-contained workflow inputs", () => {
      const result = buildSystemPrompt("/repo", {});
      expect(result).toContain("self-contained");
    });
  });
});
