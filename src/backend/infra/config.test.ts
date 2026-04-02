import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAgentConfig,
  getConfigRepositories,
  getConfigWorkflows,
  resolveAgentConfig,
} from "./config";

let configFile: string;

beforeEach(async () => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(async () => {
  await rm(configFile, { force: true });
  delete process.env.AITM_CONFIG_PATH;
});

describe("getConfigRepositories", () => {
  it("returns empty array when config file does not exist", async () => {
    expect(await getConfigRepositories()).toEqual([]);
  });

  it("returns empty array when repositories key is absent", async () => {
    await writeFile(configFile, "workflows: {}");
    expect(await getConfigRepositories()).toEqual([]);
  });

  it("returns repositories from config", async () => {
    await writeFile(
      configFile,
      `
repositories:
  - path: /projects/org/repo1
  - path: /projects/org/repo2
`,
    );
    expect(await getConfigRepositories()).toEqual([
      { path: "/projects/org/repo1" },
      { path: "/projects/org/repo2" },
    ]);
  });
});

describe("getConfigWorkflows", () => {
  it("returns empty object when config file does not exist", async () => {
    expect(await getConfigWorkflows()).toEqual({});
  });

  it("returns empty object when workflows key is absent", async () => {
    await writeFile(configFile, "repositories: []\n");
    expect(await getConfigWorkflows()).toEqual({});
  });

  it("parses a workflow with states and next-state transitions", async () => {
    await writeFile(
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

    const workflows = await getConfigWorkflows();

    expect(workflows).toHaveProperty("my-flow");
    const flow = workflows["my-flow"];
    expect(flow.initial_state).toBe("plan");
    expect(flow.states).toHaveProperty("plan");
    expect(flow.states).toHaveProperty("implement");

    const planState = flow.states.plan;
    expect("goal" in planState).toBe(true);
    if (!("goal" in planState)) {
      throw new Error("expected goal state");
    }
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
    expect("goal" in implementState).toBe(true);
    if (!("goal" in implementState)) {
      throw new Error("expected goal state");
    }
    expect(implementState.transitions[0]).toEqual({
      terminal: "success",
      when: "code is done",
    });
  });

  it("parses an agent override on a goal state", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: claude
  model: sonnet
workflows:
  my-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        agent:
          provider: codex
          model: gpt-5.4
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const planState = workflows["my-flow"].states.plan;

    expect("goal" in planState).toBe(true);
    if (!("goal" in planState)) {
      throw new Error("expected goal state");
    }

    expect(planState.agent).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: undefined,
      permission_mode: undefined,
    });
  });

  it("parses permission_mode override on a goal state", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_state: push
    states:
      push:
        goal: "Push and create PR"
        agent:
          permission_mode: bypassPermissions
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushState = workflows["my-flow"].states.push;

    expect("goal" in pushState).toBe(true);
    if (!("goal" in pushState)) {
      throw new Error("expected goal state");
    }

    expect(pushState.agent).toEqual({
      provider: undefined,
      model: undefined,
      command: undefined,
      permission_mode: "bypassPermissions",
    });
  });

  it("parses workflow inputs with type field", async () => {
    await writeFile(
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

    const workflows = await getConfigWorkflows();
    const flow = workflows["my-flow"];
    expect(flow.inputs).toHaveLength(3);
    expect(flow.inputs![0]).toMatchObject({ name: "title", type: "text" });
    expect(flow.inputs![1]).toMatchObject({
      name: "description",
      type: "multiline-text",
    });
    expect(flow.inputs![2].type).toBeUndefined();
  });

  it("parses a workflow with a command state", async () => {
    await writeFile(
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

    const workflows = await getConfigWorkflows();
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

  it("does not retain agent config on command states", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_state: cleanup
    states:
      cleanup:
        command: "echo cleanup"
        agent:
          provider: codex
          model: gpt-5.4
        transitions:
          - terminal: success
            when: succeeded
`,
    );

    const workflows = await getConfigWorkflows();
    const cleanupState = workflows["my-flow"].states.cleanup;

    expect("command" in cleanupState).toBe(true);
    expect(cleanupState).not.toHaveProperty("agent");
  });

  it("parses multiple workflows", async () => {
    await writeFile(
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

    const workflows = await getConfigWorkflows();
    expect(Object.keys(workflows)).toContain("flow-a");
    expect(Object.keys(workflows)).toContain("flow-b");
  });
});

describe("getAgentConfig", () => {
  it("defaults to claude when agent config is absent", async () => {
    await writeFile(configFile, "workflows: {}\n");
    expect(await getAgentConfig()).toEqual({ provider: "claude" });
  });

  it("parses codex agent settings", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: codex
  model: gpt-5.4
  command: /opt/homebrew/bin/codex
workflows: {}
`,
    );

    expect(await getAgentConfig()).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    });
  });

  it("parses permission_mode from agent config", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: codex
  permission_mode: bypassPermissions
workflows: {}
`,
    );

    const config = await getAgentConfig();
    expect(config.permission_mode).toBe("bypassPermissions");
  });
});

describe("resolveAgentConfig", () => {
  it("inherits provider from the top-level agent config when omitted in the override", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: codex
  model: gpt-5.4
  command: /opt/homebrew/bin/codex
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        model: "gpt-5.4-mini",
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.4-mini",
      command: "/opt/homebrew/bin/codex",
    });
  });

  it("lets a state override replace the top-level provider", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: claude
  model: sonnet
  command: /opt/homebrew/bin/claude
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        provider: "codex",
        model: "gpt-5.4",
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: undefined,
    });
  });

  it("keeps an explicit override command when switching providers", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: claude
  model: sonnet
  command: /opt/homebrew/bin/claude
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        provider: "codex",
        model: "gpt-5.4",
        command: "/opt/homebrew/bin/codex",
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    });
  });

  it("inherits permission_mode from the top-level agent config", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: codex
  permission_mode: bypassPermissions
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        model: "gpt-5.4",
      }),
    ).toMatchObject({
      provider: "codex",
      permission_mode: "bypassPermissions",
    });
  });

  it("lets a state override replace the permission_mode", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: codex
  permission_mode: acceptEdits
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        permission_mode: "bypassPermissions",
      }),
    ).toMatchObject({
      provider: "codex",
      permission_mode: "bypassPermissions",
    });
  });

  it("does not inherit model or command when switching providers without restating them", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: claude
  model: sonnet
  command: /opt/homebrew/bin/claude
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        provider: "codex",
      }),
    ).toEqual({
      provider: "codex",
      model: undefined,
      command: undefined,
    });
  });
});
