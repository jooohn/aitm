import { chmod, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAgentConfig,
  getConfigRepositories,
  getConfigWorkflows,
  initializeConfig,
  resetConfigForTests,
  resolveAgentConfig,
} from "./config";

let configDir: string;
let configFile: string;

async function writeConfig(content: string) {
  await writeFile(configFile, content, "utf8");
}

beforeEach(async () => {
  configDir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(configDir, { recursive: true });
  configFile = join(configDir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
  resetConfigForTests();
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
  delete process.env.AITM_CONFIG_PATH;
  resetConfigForTests();
});

describe("config initialization", () => {
  it("fails when getters are used before initialization", async () => {
    await expect(getConfigRepositories()).rejects.toThrow(
      "Configuration has not been initialized",
    );
    await expect(getAgentConfig()).rejects.toThrow(
      "Configuration has not been initialized",
    );
    await expect(getConfigWorkflows()).rejects.toThrow(
      "Configuration has not been initialized",
    );
  });

  it("fails when the config file is missing", async () => {
    await expect(initializeConfig()).rejects.toThrow(configFile);
    await expect(initializeConfig()).rejects.toThrow("Config file not found");
  });

  it("fails when the config file is unreadable", async () => {
    await writeConfig("workflows: {}\n");
    await chmod(configFile, 0o000);

    await expect(initializeConfig()).rejects.toThrow("Unable to read config");
  });

  it("fails on invalid yaml", async () => {
    await writeConfig("workflows: [\n");

    await expect(initializeConfig()).rejects.toThrow("Invalid YAML");
  });

  it("fails on invalid top-level shape", async () => {
    await writeConfig("- not-a-map\n");

    await expect(initializeConfig()).rejects.toThrow("Invalid config root");
  });

  it("fails on invalid workflow invariants", async () => {
    await writeConfig(`
workflows:
  bad-flow:
    initial_step: missing
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);

    await expect(initializeConfig()).rejects.toThrow(
      "workflows.bad-flow.initial_step must reference an existing step",
    );
  });

  it("fails when workflows is a non-object value", async () => {
    await writeConfig(`
workflows: ""
`);

    await expect(initializeConfig()).rejects.toThrow(
      "workflows must be an object",
    );
  });

  it("fails on invalid metadata shape instead of dropping it", async () => {
    await writeConfig(`
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          metadata:
            pr_url: "not-an-object"
        transitions:
          - terminal: success
            when: done
`);

    await expect(initializeConfig()).rejects.toThrow(
      "workflows.my-flow.steps.push.output.metadata.pr_url must be an object",
    );
  });

  it("fails on unknown metadata presets instead of dropping them", async () => {
    await writeConfig(`
workflows:
  my-flow:
    initial_step: push
    steps:
      push:
        goal: "Push and create PR"
        output:
          presets:
            - typoed_preset
        transitions:
          - terminal: success
            when: done
`);

    await expect(initializeConfig()).rejects.toThrow(
      "workflows.my-flow.steps.push.output.presets[0] must reference a known preset",
    );
  });

  it("fails when a step mixes agent and command fields", async () => {
    await writeConfig(`
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        type: agent
        goal: "Write a plan"
        command: "npm test"
        transitions:
          - terminal: success
            when: done
`);

    await expect(initializeConfig()).rejects.toThrow(
      "workflows.my-flow.steps.plan cannot define command for an agent step",
    );
  });

  it("loads once and keeps serving the cached snapshot", async () => {
    await writeConfig(`
agent:
  provider: codex
  model: gpt-5.4
repositories:
  - path: /projects/org/repo1
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);

    await initializeConfig();
    await writeConfig("workflows: {}\n");

    await expect(getConfigRepositories()).resolves.toEqual([
      { path: "/projects/org/repo1" },
    ]);
    await expect(getAgentConfig()).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: undefined,
      permission_mode: undefined,
    });
    await expect(getConfigWorkflows()).resolves.toMatchObject({
      "my-flow": { initial_step: "plan" },
    });
  });

  it("normalizes valid workflows after initialization", async () => {
    await writeConfig(`
agent:
  provider: claude
  model: sonnet
  permission_mode: edit
repositories:
  - path: /projects/org/repo1
workflows:
  my-flow:
    inputs:
      title:
        label: Title
        type: text
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        agent:
          provider: codex
          model: gpt-5.4
        output:
          presets:
            - pull_request_url
          metadata:
            summary:
              type: string
              description: Summary
        transitions:
          - step: apply
            when: ready
      apply:
        type: command
        command: "npm test"
        transitions:
          - step: approve
            when: passed
      approve:
        type: manual-approval
        transitions:
          - terminal: success
            when: approved
`);

    await initializeConfig();

    await expect(getConfigRepositories()).resolves.toEqual([
      { path: "/projects/org/repo1" },
    ]);
    await expect(getConfigWorkflows()).resolves.toEqual({
      "my-flow": {
        initial_step: "plan",
        inputs: [{ name: "title", label: "Title", type: "text" }],
        steps: {
          plan: {
            type: "agent",
            goal: "Write a plan",
            agent: {
              provider: "codex",
              model: "gpt-5.4",
              command: undefined,
              permission_mode: undefined,
            },
            output: {
              metadata: {
                presets__pull_request_url: {
                  type: "string",
                  description:
                    "The URL of the pull request created for this change",
                },
                summary: { type: "string", description: "Summary" },
              },
            },
            transitions: [{ step: "apply", when: "ready" }],
          },
          apply: {
            type: "command",
            command: "npm test",
            transitions: [{ step: "approve", when: "passed" }],
          },
          approve: {
            type: "manual-approval",
            transitions: [{ terminal: "success", when: "approved" }],
          },
        },
      },
    });
  });
});

describe("resolveAgentConfig", () => {
  it("inherits provider fields from the cached base config", async () => {
    await writeConfig(`
agent:
  provider: codex
  model: gpt-5.4
  command: /opt/homebrew/bin/codex
  permission_mode: full
workflows: {}
`);

    await initializeConfig();

    await expect(
      resolveAgentConfig({
        model: "gpt-5.4-mini",
      }),
    ).resolves.toEqual({
      provider: "codex",
      model: "gpt-5.4-mini",
      command: "/opt/homebrew/bin/codex",
      permission_mode: "full",
    });
  });

  it("drops provider-specific fields when switching providers", async () => {
    await writeConfig(`
agent:
  provider: claude
  model: sonnet
  command: /opt/homebrew/bin/claude
  permission_mode: edit
workflows: {}
`);

    await initializeConfig();

    await expect(
      resolveAgentConfig({
        provider: "codex",
        permission_mode: "full",
      }),
    ).resolves.toEqual({
      provider: "codex",
      model: undefined,
      command: undefined,
      permission_mode: "full",
    });
  });
});
