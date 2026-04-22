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

  describe("agents map and default-agent", () => {
    it("parses agents map and default-agent", async () => {
      await writeConfig(`
agents:
  claude-sonnet:
    provider: claude
    model: sonnet
  codex-gpt5:
    provider: codex
    model: gpt-5.4
default-agent: claude-sonnet
repositories:
  - path: /projects/org/repo1
`);

      const snapshot = loadConfig();
      expect(snapshot.agents).toEqual({
        "claude-sonnet": {
          provider: "claude",
          model: "sonnet",
          command: undefined,
          permission_mode: undefined,
        },
        "codex-gpt5": {
          provider: "codex",
          model: "gpt-5.4",
          command: undefined,
          permission_mode: undefined,
        },
      });
      expect(snapshot.default_agent).toBe("claude-sonnet");
    });

    it("defaults to a single claude agent when agents and default-agent are omitted", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
`);

      const snapshot = loadConfig();
      expect(snapshot.agents).toEqual({
        default: { provider: "claude" },
      });
      expect(snapshot.default_agent).toBe("default");
    });

    it("fails when default-agent references an unknown alias", async () => {
      await writeConfig(`
agents:
  claude-sonnet:
    provider: claude
    model: sonnet
default-agent: nonexistent
`);

      expect(() => loadConfig()).toThrow(
        "default-agent must reference a key in agents",
      );
    });

    it("fails when agents entry is missing provider", async () => {
      await writeConfig(`
agents:
  my-agent:
    model: sonnet
default-agent: my-agent
`);

      expect(() => loadConfig()).toThrow("agents.my-agent.provider");
    });

    it("fails when the old top-level agent object is used", async () => {
      await writeConfig(`
agent:
  provider: codex
  model: gpt-5.4
`);

      expect(() => loadConfig()).toThrow(
        "Top-level 'agent' object is no longer supported",
      );
    });

    it("fails when agents is not an object", async () => {
      await writeConfig(`
agents: "not-an-object"
default-agent: foo
`);

      expect(() => loadConfig()).toThrow("agents must be an object");
    });

    it("fails when default-agent is provided without agents", async () => {
      await writeConfig(`
default-agent: my-agent
`);

      expect(() => loadConfig()).toThrow(
        "default-agent must reference a key in agents",
      );
    });

    it("parses agent with all optional fields", async () => {
      await writeConfig(`
agents:
  claude-full:
    provider: claude
    model: sonnet
    command: /opt/homebrew/bin/claude
    permission_mode: full
default-agent: claude-full
`);

      const snapshot = loadConfig();
      expect(snapshot.agents["claude-full"]).toEqual({
        provider: "claude",
        model: "sonnet",
        command: "/opt/homebrew/bin/claude",
        permission_mode: "full",
      });
    });
  });

  describe("step-level agent alias", () => {
    it("parses step agent as a string alias", async () => {
      await writeConfig(`
agents:
  claude-sonnet:
    provider: claude
    model: sonnet
  codex-gpt5:
    provider: codex
    model: gpt-5.4
default-agent: claude-sonnet
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        agent: codex-gpt5
        transitions:
          - terminal: success
            when: done
`);

      const snapshot = loadConfig();
      const step = snapshot.workflows["my-flow"].steps.plan;
      expect(step.type).toBe("agent");
      if (step.type === "agent") {
        expect(step.agent).toBe("codex-gpt5");
      }
    });

    it("fails when step agent references an unknown alias", async () => {
      await writeConfig(`
agents:
  claude-sonnet:
    provider: claude
    model: sonnet
default-agent: claude-sonnet
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        agent: nonexistent
        transitions:
          - terminal: success
            when: done
`);

      expect(() => loadConfig()).toThrow(
        "workflows.my-flow.steps.plan.agent must reference a key in agents",
      );
    });

    it("allows steps without an agent field (uses default)", async () => {
      await writeConfig(`
agents:
  claude-sonnet:
    provider: claude
    model: sonnet
default-agent: claude-sonnet
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
      const step = snapshot.workflows["my-flow"].steps.plan;
      expect(step.type).toBe("agent");
      if (step.type === "agent") {
        expect(step.agent).toBeUndefined();
      }
    });

    it("fails when step agent is an inline object instead of a string", async () => {
      await writeConfig(`
agents:
  claude-sonnet:
    provider: claude
    model: sonnet
default-agent: claude-sonnet
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
            when: done
`);

      expect(() => loadConfig()).toThrow(
        "workflows.my-flow.steps.plan.agent must be a string",
      );
    });
  });

  describe("runs_on", () => {
    it("parses runs_on: main", async () => {
      await writeConfig(`
workflows:
  investigate:
    runs_on: main
    initial_step: look
    steps:
      look:
        goal: "Investigate the issue"
        transitions:
          - terminal: success
            when: done
`);

      const snapshot = loadConfig();
      expect(snapshot.workflows.investigate.runs_on).toBe("main");
    });

    it("parses runs_on: worktree", async () => {
      await writeConfig(`
workflows:
  my-flow:
    runs_on: worktree
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);

      const snapshot = loadConfig();
      expect(snapshot.workflows["my-flow"].runs_on).toBe("worktree");
    });

    it("results in undefined when runs_on is omitted", async () => {
      await writeConfig(`
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
      expect(snapshot.workflows["my-flow"].runs_on).toBeUndefined();
    });

    it("fails on invalid runs_on value", async () => {
      await writeConfig(`
workflows:
  my-flow:
    runs_on: branch
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);

      expect(() => loadConfig()).toThrow(
        'runs_on must be "main" or "worktree"',
      );
    });
  });

  describe("repository commands", () => {
    it("parses repositories with commands", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      nextjs-dev:
        label: "Launch Next dev server"
        command: "npm run dev"
      tests:
        label: "Run tests"
        command: "npm run test:watch"
`);

      const snapshot = loadConfig();
      expect(snapshot.repositories).toEqual([
        {
          path: "/projects/org/repo1",
          commands: [
            {
              id: "nextjs-dev",
              label: "Launch Next dev server",
              command: "npm run dev",
            },
            {
              id: "tests",
              label: "Run tests",
              command: "npm run test:watch",
            },
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

    it("defaults the label to the command id when omitted", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      dev:
        command: "npm run dev"
`);

      const snapshot = loadConfig();
      expect(snapshot.repositories).toEqual([
        {
          path: "/projects/org/repo1",
          commands: [{ id: "dev", label: "dev", command: "npm run dev" }],
        },
      ]);
    });

    it("fails when command entry is missing command", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    commands:
      dev:
        label: "Dev server"
`);

      expect(() => loadConfig()).toThrow("repositories");
    });
  });

  describe("repository workflows", () => {
    it("parses repository with workflows filter", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    workflows:
      - my-flow
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
      expect(snapshot.repositories[0].workflows).toEqual(["my-flow"]);
    });

    it("omits workflows field when not specified", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
`);

      const snapshot = loadConfig();
      expect(snapshot.repositories[0].workflows).toBeUndefined();
    });

    it("fails when repository references unknown workflow", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    workflows:
      - nonexistent-flow
workflows: {}
`);

      expect(() => loadConfig()).toThrow(
        'repositories[0].workflows references unknown workflow "nonexistent-flow"',
      );
    });

    it("accepts empty workflows array", async () => {
      await writeConfig(`
repositories:
  - path: /projects/org/repo1
    workflows: []
`);

      const snapshot = loadConfig();
      expect(snapshot.repositories[0].workflows).toBeUndefined();
    });
  });

  it("normalizes valid workflows with agent aliases", async () => {
    await writeConfig(`
agents:
  claude-edit:
    provider: claude
    model: sonnet
    permission_mode: edit
  codex-gpt5:
    provider: codex
    model: gpt-5.4
default-agent: claude-edit
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
        agent: codex-gpt5
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

    expect(snapshot.agents).toEqual({
      "claude-edit": {
        provider: "claude",
        model: "sonnet",
        command: undefined,
        permission_mode: "edit",
      },
      "codex-gpt5": {
        provider: "codex",
        model: "gpt-5.4",
        command: undefined,
        permission_mode: undefined,
      },
    });
    expect(snapshot.default_agent).toBe("claude-edit");
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
            agent: "codex-gpt5",
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
  it("returns the agent for the given alias", () => {
    const agents = {
      "claude-sonnet": {
        provider: "claude" as const,
        model: "sonnet",
      },
      "codex-gpt5": {
        provider: "codex" as const,
        model: "gpt-5.4",
      },
    };

    expect(resolveAgentConfig(agents, "codex-gpt5", "claude-sonnet")).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });
  });

  it("returns the default agent when no alias is provided", () => {
    const agents = {
      "claude-sonnet": {
        provider: "claude" as const,
        model: "sonnet",
      },
    };

    expect(resolveAgentConfig(agents, undefined, "claude-sonnet")).toEqual({
      provider: "claude",
      model: "sonnet",
    });
  });

  it("throws when alias is not found in agents map", () => {
    const agents = {
      "claude-sonnet": {
        provider: "claude" as const,
        model: "sonnet",
      },
    };

    expect(() =>
      resolveAgentConfig(agents, "nonexistent", "claude-sonnet"),
    ).toThrow("nonexistent");
  });
});
