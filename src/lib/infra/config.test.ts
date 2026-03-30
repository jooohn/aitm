import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigRepositories, getConfigWorkflows } from "./config";

let configFile: string;

beforeEach(() => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(() => {
  rmSync(configFile, { force: true });
  delete process.env.AITM_CONFIG_PATH;
});

describe("getConfigRepositories", () => {
  it("returns empty array when config file does not exist", () => {
    expect(getConfigRepositories()).toEqual([]);
  });

  it("returns empty array when repositories key is absent", () => {
    writeFileSync(configFile, "workflows: {}");
    expect(getConfigRepositories()).toEqual([]);
  });

  it("returns repositories from config", () => {
    writeFileSync(
      configFile,
      `
repositories:
  - path: /projects/org/repo1
  - path: /projects/org/repo2
`,
    );
    expect(getConfigRepositories()).toEqual([
      { path: "/projects/org/repo1" },
      { path: "/projects/org/repo2" },
    ]);
  });
});

describe("getConfigWorkflows", () => {
  it("returns empty object when config file does not exist", () => {
    expect(getConfigWorkflows()).toEqual({});
  });

  it("returns empty object when workflows key is absent", () => {
    writeFileSync(configFile, "repositories: []\n");
    expect(getConfigWorkflows()).toEqual({});
  });

  it("parses a workflow with states and next-state transitions", () => {
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - state: implement
            when: "plan is ready"
          - terminal: failure
            when: "cannot proceed"
      implement:
        goal: "Write the code"
        transitions:
          - terminal: success
            when: "code is done"
`,
    );

    const workflows = getConfigWorkflows();

    expect(workflows).toHaveProperty("my-flow");
    const flow = workflows["my-flow"];
    expect(flow.initial_state).toBe("plan");
    expect(flow.states).toHaveProperty("plan");
    expect(flow.states).toHaveProperty("implement");

    const planState = flow.states.plan;
    expect(planState.goal).toBe("Write a plan");
    expect(planState.transitions).toHaveLength(2);
    expect(planState.transitions[0]).toEqual({
      state: "implement",
      when: "plan is ready",
    });
    expect(planState.transitions[1]).toEqual({
      terminal: "failure",
      when: "cannot proceed",
    });

    const implementState = flow.states.implement;
    expect(implementState.transitions[0]).toEqual({
      terminal: "success",
      when: "code is done",
    });
  });

  it("parses workflow inputs with type field", () => {
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: step1
    inputs:
      title:
        label: Title
        type: text
      description:
        label: Description
        type: multiline-text
      notes:
        label: Notes
    states:
      step1:
        goal: "Do step 1"
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = getConfigWorkflows();
    const flow = workflows["my-flow"];
    expect(flow.inputs).toHaveLength(3);
    expect(flow.inputs![0]).toMatchObject({ name: "title", type: "text" });
    expect(flow.inputs![1]).toMatchObject({
      name: "description",
      type: "multiline-text",
    });
    expect(flow.inputs![2].type).toBeUndefined();
  });

  it("parses a workflow with a command state", () => {
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: cleanup
    states:
      cleanup:
        command: "rm -rf PLAN.md"
        transitions:
          - state: commit
            when: succeeded
          - terminal: failure
            when: failed
      commit:
        goal: "Commit the changes"
        transitions:
          - terminal: success
            when: "committed"
`,
    );

    const workflows = getConfigWorkflows();
    const flow = workflows["my-flow"];
    expect(flow.initial_state).toBe("cleanup");

    const cleanupState = flow.states.cleanup;
    expect("command" in cleanupState).toBe(true);
    if ("command" in cleanupState) {
      expect(cleanupState.command).toBe("rm -rf PLAN.md");
    }
    expect(cleanupState.transitions).toHaveLength(2);
    expect(cleanupState.transitions[0]).toEqual({
      state: "commit",
      when: "succeeded",
    });
    expect(cleanupState.transitions[1]).toEqual({
      terminal: "failure",
      when: "failed",
    });

    const commitState = flow.states.commit;
    expect("goal" in commitState).toBe(true);
  });

  it("parses multiple workflows", () => {
    writeFileSync(
      configFile,
      `
workflows:
  flow-a:
    initial_state: step1
    states:
      step1:
        goal: "Do step 1"
        transitions:
          - terminal: success
            when: "done"
  flow-b:
    initial_state: start
    states:
      start:
        goal: "Do start"
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = getConfigWorkflows();
    expect(Object.keys(workflows)).toContain("flow-a");
    expect(Object.keys(workflows)).toContain("flow-b");
  });
});
