import { chmod, rm, writeFile } from "fs/promises";
import { dirname } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestConfigDir } from "@/test-config-helper";
import { loadConfig, resolveAgentConfig } from "./config";

let configFile: string;

async function writeConfig(content: string) {
  await writeFile(configFile, content, "utf8");
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();
});

afterEach(async () => {
  await rm(dirname(configFile), { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("fails when the config file is missing", async () => {
    expect(() => loadConfig()).toThrow("Config file not found");
  });

  it("fails when the config file is unreadable", async () => {
    await writeConfig("workflows: {}\n");
    await chmod(configFile, 0o000);

    expect(() => loadConfig()).toThrow("Unable to read config");
  });

  it("fails on invalid yaml", async () => {
    await writeConfig("workflows: [\n");

    expect(() => loadConfig()).toThrow("Invalid YAML");
  });

  it("fails on invalid top-level shape", async () => {
    await writeConfig("- not-a-map\n");

    expect(() => loadConfig()).toThrow("Invalid config root");
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

    expect(() => loadConfig()).toThrow(
      "workflows.bad-flow.initial_step must reference an existing step",
    );
  });

  it("fails when workflows is a non-object value", async () => {
    await writeConfig(`
workflows: ""
`);

    expect(() => loadConfig()).toThrow("workflows must be an object");
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

    expect(() => loadConfig()).toThrow(
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

    expect(() => loadConfig()).toThrow(
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

    expect(() => loadConfig()).toThrow(
      "workflows.my-flow.steps.plan cannot define command for an agent step",
    );
  });

  it("fails when an artifact path escapes the artifact root", async () => {
    await writeConfig(`
workflows:
  my-flow:
    initial_step: plan
    artifacts:
      plan:
        path: ../PLAN.md
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);

    expect(() => loadConfig()).toThrow(
      "workflows.my-flow.artifacts.plan.path must not escape the artifact root",
    );
  });

  it("returns a fresh snapshot on each call", async () => {
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

    const snapshot = loadConfig();
    expect(snapshot.repositories).toEqual([{ path: "/projects/org/repo1" }]);
    expect(snapshot.agent).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: undefined,
      permission_mode: undefined,
    });
    expect(snapshot.workflows).toMatchObject({
      "my-flow": { initial_step: "plan" },
    });
  });

  describe("repository commands", () => {
    it("parses repositories with commands", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      - label: "Launch Next dev server"
        command: "npm run dev"
      - label: "Run tests"
        command: "npm run test:watch"
`);

      const snapshot = loadConfig();
      expect(snapshot.repositories).toEqual([
        {
          path: "/projects/org/repo1",
          commands: [
            { label: "Launch Next dev server", command: "npm run dev" },
            { label: "Run tests", command: "npm run test:watch" },
          ],
        },
      ]);
    });

    it("parses repositories without commands", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
`);

      const snapshot = loadConfig();
      expect(snapshot.repositories).toEqual([{ path: "/projects/org/repo1" }]);
    });

    it("fails when command entry is missing label", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      - command: "npm run dev"
`);

      expect(() => loadConfig()).toThrow("repositories");
    });

    it("fails when command entry is missing command", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      - label: "Dev server"
`);

      expect(() => loadConfig()).toThrow("repositories");
    });

    it("fails when commands has duplicate labels", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      - label: "Dev"
        command: "npm run dev"
      - label: "Dev"
        command: "npm start"
`);

      expect(() => loadConfig()).toThrow(
        'repositories[0].commands has duplicate label "Dev"',
      );
    });
  });

  it("normalizes valid workflows", async () => {
    await writeConfig(`
agent:
  provider: claude
  model: sonnet
  permission_mode: edit
repositories:
  - path: /projects/org/repo1
workflows:
  my-flow:
    label: My Flow
    inputs:
      title:
        label: Title
        type: text
    artifacts:
      plan:
        path: plan.md
        description: Shared plan for the run
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
  follow-up:
    label: Maintain PR
    recommended_when:
      condition: $.run.metadata.presets__pull_request_url
      inputs:
        pr-url: $.run.metadata.presets__pull_request_url
        source-run-id: $.run.id
    initial_step: inspect
    steps:
      inspect:
        goal: "Inspect the pull request"
        transitions:
          - terminal: success
            when: done
`);

    const snapshot = loadConfig();

    expect(snapshot.repositories).toEqual([{ path: "/projects/org/repo1" }]);
    expect(snapshot.workflows).toEqual({
      "my-flow": {
        label: "My Flow",
        initial_step: "plan",
        inputs: [{ name: "title", label: "Title", type: "text" }],
        artifacts: [
          {
            name: "plan",
            path: "plan.md",
            description: "Shared plan for the run",
          },
        ],
        recommended_when: undefined,
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
      "follow-up": {
        label: "Maintain PR",
        initial_step: "inspect",
        inputs: undefined,
        recommended_when: {
          condition: "$.run.metadata.presets__pull_request_url",
          inputs: {
            "pr-url": "$.run.metadata.presets__pull_request_url",
            "source-run-id": "$.run.id",
          },
        },
        steps: {
          inspect: {
            type: "agent",
            goal: "Inspect the pull request",
            agent: undefined,
            output: undefined,
            transitions: [{ terminal: "success", when: "done" }],
          },
        },
      },
    });
  });
});

describe("resolveAgentConfig", () => {
  it("inherits provider fields from the base config", () => {
    const base = {
      provider: "codex" as const,
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
      permission_mode: "full" as const,
    };

    expect(
      resolveAgentConfig(base, {
        model: "gpt-5.4-mini",
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.4-mini",
      command: "/opt/homebrew/bin/codex",
      permission_mode: "full",
    });
  });

  it("drops provider-specific fields when switching providers", () => {
    const base = {
      provider: "claude" as const,
      model: "sonnet",
      command: "/opt/homebrew/bin/claude",
      permission_mode: "edit" as const,
    };

    expect(
      resolveAgentConfig(base, {
        provider: "codex",
        permission_mode: "full",
      }),
    ).toEqual({
      provider: "codex",
      model: undefined,
      command: undefined,
      permission_mode: "full",
    });
  });
});
