import { describe, expect, it } from "vitest";
import type {
  ConfigRepository,
  WorkflowDefinition,
} from "@/backend/infra/config";
import { filterWorkflowsForRepository } from "./filter";

const workflow = (goal: string): WorkflowDefinition => ({
  initial_step: "plan",
  steps: {
    plan: {
      type: "agent",
      goal,
      transitions: [{ terminal: "success" as const, when: "done" }],
    },
  },
});

const allWorkflows: Record<string, WorkflowDefinition> = {
  "dev-flow": workflow("Develop"),
  "bugfix-flow": workflow("Fix bugs"),
  "deploy-flow": workflow("Deploy"),
};

describe("filterWorkflowsForRepository", () => {
  it("returns all workflows when configRepo is undefined", () => {
    expect(filterWorkflowsForRepository(allWorkflows, undefined)).toBe(
      allWorkflows,
    );
  });

  it("returns all workflows when configRepo.workflows is undefined", () => {
    const configRepo: ConfigRepository = { path: "/repo" };
    expect(filterWorkflowsForRepository(allWorkflows, configRepo)).toBe(
      allWorkflows,
    );
  });

  it("filters to only allowed workflows", () => {
    const configRepo: ConfigRepository = {
      path: "/repo",
      workflows: ["dev-flow", "deploy-flow"],
    };
    const result = filterWorkflowsForRepository(allWorkflows, configRepo);
    expect(Object.keys(result)).toEqual(["dev-flow", "deploy-flow"]);
    expect(result["dev-flow"]).toBe(allWorkflows["dev-flow"]);
    expect(result["deploy-flow"]).toBe(allWorkflows["deploy-flow"]);
  });

  it("returns empty object when allowed list is empty", () => {
    const configRepo: ConfigRepository = {
      path: "/repo",
      workflows: [],
    };
    const result = filterWorkflowsForRepository(allWorkflows, configRepo);
    expect(Object.keys(result)).toEqual([]);
  });

  it("ignores workflow names that are not in allWorkflows", () => {
    const configRepo: ConfigRepository = {
      path: "/repo",
      workflows: ["dev-flow", "nonexistent"],
    };
    const result = filterWorkflowsForRepository(allWorkflows, configRepo);
    expect(Object.keys(result)).toEqual(["dev-flow"]);
  });

  it("returns empty when allWorkflows is empty regardless of config", () => {
    const configRepo: ConfigRepository = {
      path: "/repo",
      workflows: ["dev-flow"],
    };
    expect(filterWorkflowsForRepository({}, configRepo)).toEqual({});
  });
});
