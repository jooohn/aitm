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

  it("parses a workflow with steps and next-step transitions", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - step: implement
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
    expect(flow.initial_step).toBe("plan");
    expect(flow.steps).toHaveProperty("plan");
    expect(flow.steps).toHaveProperty("implement");

    const planStep = flow.steps.plan;
    expect("goal" in planStep).toBe(true);
    if (!("goal" in planStep)) {
      throw new Error("expected goal step");
    }
    expect(planStep.goal).toBe("Write a plan");
    expect(planStep.transitions).toHaveLength(2);
    expect(planStep.transitions[0]).toEqual({
      step: "implement",
      when: "plan is ready",
    });
    expect(planStep.transitions[1]).toEqual({
      terminal: "failure",
      when: "cannot proceed",
    });

    const implementStep = flow.steps.implement;
    expect("goal" in implementStep).toBe(true);
    if (!("goal" in implementStep)) {
      throw new Error("expected goal step");
    }
    expect(implementStep.transitions[0]).toEqual({
      terminal: "success",
      when: "code is done",
    });
  });

  it("parses an agent override on a goal step", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: claude
  model: sonnet
workflows:
  my-flow:
    initial_step: plan
    steps:
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
    const planStep = workflows["my-flow"].steps.plan;

    expect("goal" in planStep).toBe(true);
    if (!("goal" in planStep)) {
      throw new Error("expected goal step");
    }

    expect(planStep.agent).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: undefined,
      permission_mode: undefined,
    });
  });

  it("parses permission_mode override on a goal step", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        agent:
          permission_mode: full
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.agent).toEqual({
      provider: undefined,
      model: undefined,
      command: undefined,
      permission_mode: "full",
    });
  });

  it("parses workflow inputs with type field", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: step1
    inputs:
      title:
        label: Title
        type: text
      description:
        label: Description
        type: multiline-text
      notes:
        label: Notes
    steps:
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

  it("parses a workflow with a command step", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: cleanup
    steps:
      cleanup:
        command: "rm -rf PLAN.md"
        transitions:
          - step: commit
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
    expect(flow.initial_step).toBe("cleanup");

    const cleanupStep = flow.steps.cleanup;
    expect("command" in cleanupStep).toBe(true);
    if ("command" in cleanupStep) {
      expect(cleanupStep.command).toBe("rm -rf PLAN.md");
    }
    expect(cleanupStep.transitions).toHaveLength(2);
    expect(cleanupStep.transitions[0]).toEqual({
      step: "commit",
      when: "succeeded",
    });
    expect(cleanupStep.transitions[1]).toEqual({
      terminal: "failure",
      when: "failed",
    });

    const commitStep = flow.steps.commit;
    expect("goal" in commitStep).toBe(true);
  });

  it("parses output.metadata on an agent step", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          metadata:
            pr_url:
              type: string
              description: "The pull request URL"
            pr_number:
              type: string
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.output).toEqual({
      metadata: {
        pr_url: { type: "string", description: "The pull request URL" },
        pr_number: { type: "string" },
      },
    });
  });

  it("strips metadata fields with invalid shape (not an object with type)", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          metadata:
            pr_url:
              type: string
              description: "The pull request URL"
            bad_field: "just a string"
            also_bad:
              description: "missing type"
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    // Only pr_url should survive validation
    expect(pushStep.output).toEqual({
      metadata: {
        pr_url: { type: "string", description: "The pull request URL" },
      },
    });
  });

  it("rejects metadata field names that collide with core decision keys", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          metadata:
            transition:
              type: string
              description: "This collides with a core field"
            reason:
              type: string
            pr_url:
              type: string
              description: "The pull request URL"
            handoff_summary:
              type: string
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    // Only pr_url should survive — core field names are filtered out
    expect(pushStep.output).toEqual({
      metadata: {
        pr_url: { type: "string", description: "The pull request URL" },
      },
    });
  });

  it("sets output to undefined when all metadata fields are invalid", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          metadata:
            transition:
              type: string
            bad_field: 42
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.output).toBeUndefined();
  });

  it("resolves output.presets into prefixed metadata fields", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          presets:
            - pull_request_url
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.output).toEqual({
      metadata: {
        presets__pull_request_url: {
          type: "string",
          description: "The URL of the pull request created for this change",
        },
      },
    });
  });

  it("ignores unknown preset names", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          presets:
            - pull_request_url
            - unknown_preset
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.output).toEqual({
      metadata: {
        presets__pull_request_url: {
          type: "string",
          description: "The URL of the pull request created for this change",
        },
      },
    });
  });

  it("merges presets with explicit metadata fields", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          presets:
            - pull_request_url
          metadata:
            custom_field:
              type: string
              description: "A custom field"
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.output).toEqual({
      metadata: {
        presets__pull_request_url: {
          type: "string",
          description: "The URL of the pull request created for this change",
        },
        custom_field: {
          type: "string",
          description: "A custom field",
        },
      },
    });
  });

  it("sets output to undefined when all presets are unknown and no metadata", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          presets:
            - unknown_preset
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const pushStep = workflows["my-flow"].steps.push;

    expect("goal" in pushStep).toBe(true);
    if (!("goal" in pushStep)) {
      throw new Error("expected goal step");
    }

    expect(pushStep.output).toBeUndefined();
  });

  it("omits output when not specified on agent step", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const workflows = await getConfigWorkflows();
    const planStep = workflows["my-flow"].steps.plan;

    expect("goal" in planStep).toBe(true);
    if (!("goal" in planStep)) {
      throw new Error("expected goal step");
    }

    expect(planStep.output).toBeUndefined();
  });

  it("does not retain agent config on command steps", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    initial_step: cleanup
    steps:
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
    const cleanupStep = workflows["my-flow"].steps.cleanup;

    expect("command" in cleanupStep).toBe(true);
    expect(cleanupStep).not.toHaveProperty("agent");
  });

  it("parses multiple workflows", async () => {
    await writeFile(
      configFile,
      `
workflows:
  flow-a:
    initial_step: step1
    steps:
      step1:
        goal: "Do step 1"
        transitions:
          - terminal: success
            when: "done"
  flow-b:
    initial_step: start
    steps:
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
  permission_mode: full
workflows: {}
`,
    );

    const config = await getAgentConfig();
    expect(config.permission_mode).toBe("full");
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

  it("lets a step override replace the top-level provider", async () => {
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
  permission_mode: full
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        model: "gpt-5.4",
      }),
    ).toMatchObject({
      provider: "codex",
      permission_mode: "full",
    });
  });

  it("lets a step override replace the permission_mode", async () => {
    await writeFile(
      configFile,
      `
agent:
  provider: codex
  permission_mode: edit
workflows: {}
`,
    );

    expect(
      await resolveAgentConfig({
        permission_mode: "full",
      }),
    ).toMatchObject({
      provider: "codex",
      permission_mode: "full",
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
