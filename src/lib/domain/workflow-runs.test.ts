import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../infra/db";
import {
  completeStateExecution,
  completeWaitForInputStateExecution,
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  rerunWorkflowRunFromFailedState,
  submitWorkflowRunInput,
} from "./workflow-runs";
import { listWorktrees } from "./worktrees";

vi.mock("./worktrees");

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeTempConfig(content: string): string {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, "config.yaml");
  writeFileSync(configPath, content, "utf8");
  return configPath;
}

const SIMPLE_WORKFLOW_CONFIG = `
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
          - terminal: failure
            when: "blocked"
`;

let originalConfigPath: string | undefined;

beforeEach(() => {
  originalConfigPath = process.env.AITM_CONFIG_PATH;
  db.prepare("DELETE FROM session_messages").run();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM state_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();
});

afterEach(() => {
  vi.clearAllMocks();
  if (originalConfigPath === undefined) {
    delete process.env.AITM_CONFIG_PATH;
  } else {
    process.env.AITM_CONFIG_PATH = originalConfigPath;
  }
});

describe("createWorkflowRun", () => {
  it("creates a workflow_run record in running status at initial_state", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    expect(run.id).toBeTypeOf("string");
    expect(run.repository_path).toBe(repoPath);
    expect(run.worktree_branch).toBe("feat/test");
    expect(run.workflow_name).toBe("my-flow");
    expect(run.current_state).toBe("plan");
    expect(run.status).toBe("running");
    expect(run.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("creates a session for the initial state", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const sessions = db
      .prepare("SELECT * FROM sessions WHERE repository_path = ?")
      .all(repoPath) as { worktree_branch: string; goal: string }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].worktree_branch).toBe("feat/test");
    expect(sessions[0].goal).toContain("Write a plan");

    const executions = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { state: string }[];
    expect(executions).toHaveLength(1);
    expect(executions[0].state).toBe("plan");
  });

  it("throws when workflow is not found in config", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();

    expect(() =>
      createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "nonexistent-flow",
      }),
    ).toThrow("Workflow not found");
  });

  it("stores inputs as JSON on the workflow run record", () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`;
    process.env.AITM_CONFIG_PATH = writeTempConfig(configWithInputs);
    const repoPath = makeFakeGitRepo();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { "feature-description": "Implement login page" },
    });

    expect(run.inputs).toBe(
      JSON.stringify({ "feature-description": "Implement login page" }),
    );
  });

  it("injects inputs into the initial session goal as an <inputs> block", () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
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
          - terminal: failure
            when: "blocked"
`;
    process.env.AITM_CONFIG_PATH = writeTempConfig(configWithInputs);
    const repoPath = makeFakeGitRepo();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { "feature-description": "Implement login page" },
    });

    const planExec = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .get(run.id) as { id: string };
    const planSession = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(planExec.id) as { goal: string };

    expect(planSession.goal).toContain("<inputs>");
    expect(planSession.goal).toContain(
      "feature-description: Implement login page",
    );
    expect(planSession.goal).toContain("</inputs>");
  });

  it("does not inject inputs block into subsequent state session goals", () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
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
          - terminal: failure
            when: "blocked"
`;
    process.env.AITM_CONFIG_PATH = writeTempConfig(configWithInputs);
    const repoPath = makeFakeGitRepo();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { "feature-description": "Implement login page" },
    });

    const [planExec] = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string; state: string }[];

    completeStateExecution(planExec.id, {
      transition: "implement",
      reason: "Plan done",
      handoff_summary: "Wrote PLAN.md",
    });

    const implementExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND state = 'implement'",
      )
      .get(run.id) as { id: string };

    const implementSession = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(implementExec.id) as { goal: string };

    // The implement session should NOT have a raw <inputs> block
    expect(implementSession.goal).not.toContain("<inputs>");
    // But it should have the handoff context
    expect(implementSession.goal).toContain("<handoff>");
    expect(implementSession.goal).toContain("Wrote PLAN.md");
  });

  it("throws when a required input is missing", () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`;
    process.env.AITM_CONFIG_PATH = writeTempConfig(configWithInputs);
    const repoPath = makeFakeGitRepo();

    expect(() =>
      createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "my-flow",
        inputs: {},
      }),
    ).toThrow("Missing required input: Feature Description");
  });
});

describe("completeStateExecution", () => {
  function setupRunAtPlan() {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string; state: string }[];
    return { run, execution, repoPath };
  }

  it("transitions to next state and creates a new state execution", () => {
    const { run, execution } = setupRunAtPlan();

    completeStateExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.current_state).toBe("implement");
    expect(updatedRun?.status).toBe("running");

    const executions = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { state: string }[];
    expect(executions).toHaveLength(2);
    const states = executions.map((e) => e.state);
    expect(states).toContain("plan");
    expect(states).toContain("implement");
  });

  it("records transition_decision and handoff_summary on the completed execution", () => {
    const { execution } = setupRunAtPlan();

    completeStateExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
    });

    const completedExecution = db
      .prepare("SELECT * FROM state_executions WHERE id = ?")
      .get(execution.id) as {
      transition_decision: string;
      handoff_summary: string;
      completed_at: string;
    };
    const decision = JSON.parse(completedExecution.transition_decision);
    expect(decision.transition).toBe("implement");
    expect(decision.reason).toBe("Plan is done");
    expect(completedExecution.handoff_summary).toBe("Wrote PLAN.md");
    expect(completedExecution.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("marks workflow run as success on terminal success transition", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    // First complete plan → implement
    const [planExec] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    completeStateExecution(planExec.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    // Then complete implement → success
    const [_, implementExec] = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string; state: string }[];
    completeStateExecution(implementExec.id, {
      transition: "success",
      reason: "Code is done",
      handoff_summary: "All done",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("success");
    expect(updatedRun?.current_state).toBeNull();
  });

  it("marks workflow run as failure on terminal failure transition", () => {
    const { run, execution } = setupRunAtPlan();

    completeStateExecution(execution.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_state).toBeNull();
  });

  it("marks workflow run as failure when transition name is not valid", () => {
    const { run, execution } = setupRunAtPlan();

    completeStateExecution(execution.id, {
      transition: "nonexistent-state",
      reason: "??",
      handoff_summary: "",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_state).toBeNull();
  });

  it("passes all previous executions as handoff context to the new session goal", () => {
    const { run, execution } = setupRunAtPlan();

    completeStateExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Created PLAN.md with approach",
    });

    const implementExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND state = 'implement'",
      )
      .get(run.id) as { id: string };

    const implementSession = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(implementExec.id) as { goal: string };

    // implement session should contain the plan handoff
    expect(implementSession.goal).toContain("Created PLAN.md with approach");
    expect(implementSession.goal).toContain("plan");

    // Now complete implement and check the next session sees BOTH prior executions
    completeStateExecution(implementExec.id, {
      transition: "implement",
      reason: "Still working",
      handoff_summary: "Wrote src/index.ts",
    });

    const implement2Exec = db
      .prepare(
        `SELECT * FROM state_executions
         WHERE workflow_run_id = ? AND state = 'implement' AND id != ?`,
      )
      .get(run.id, implementExec.id) as { id: string };

    const implement2Session = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(implement2Exec.id) as { goal: string };

    // Second implement session should contain BOTH prior handoffs
    expect(implement2Session.goal).toContain("Created PLAN.md with approach");
    expect(implement2Session.goal).toContain("Wrote src/index.ts");
  });
});

describe("minimum workflow (single goal state, terminal-only transitions)", () => {
  const MINIMAL_WORKFLOW_CONFIG = `
workflows:
  minimal-flow:
    initial_state: goal
    states:
      goal:
        goal: "Do the thing"
        transitions:
          - terminal: success
            when: "done"
          - terminal: failure
            when: "blocked"
`;

  it("happy path: run reaches success after completing the only state", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(MINIMAL_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "minimal-flow",
    });

    expect(run.current_state).toBe("goal");
    expect(run.status).toBe("running");

    const [exec] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    completeStateExecution(exec.id, {
      transition: "success",
      reason: "All done",
      handoff_summary: "Finished",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("success");
    expect(updatedRun?.current_state).toBeNull();
  });
});

describe("workflow config missing `states` key", () => {
  const NO_STATES_CONFIG = `
workflows:
  no-states-flow:
    initial_state: goal
`;

  it("createWorkflowRun throws a descriptive error instead of TypeError", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(NO_STATES_CONFIG);
    const repoPath = makeFakeGitRepo();

    expect(() =>
      createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "no-states-flow",
      }),
    ).toThrow("State not found: goal");
  });

  it("completeStateExecution terminates run as failure when workflow.states is undefined at transition time", () => {
    // Create the run with a valid config first
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const [exec] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    // Swap to a config where my-flow exists but has no states key
    process.env.AITM_CONFIG_PATH = writeTempConfig(`
workflows:
  my-flow:
    initial_state: plan
`);

    // Should not throw — should terminate as failure
    completeStateExecution(exec.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_state).toBeNull();
  });
});

describe("listWorkflowRuns", () => {
  it("returns all runs ordered by created_at descending", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();

    createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
    });
    createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
    });

    const runs = listWorkflowRuns({});
    expect(runs).toHaveLength(2);
  });

  it("filters by repository_path", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoA = makeFakeGitRepo();
    const repoB = makeFakeGitRepo();

    createWorkflowRun({
      repository_path: repoA,
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
    });
    createWorkflowRun({
      repository_path: repoB,
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
    });

    const runs = listWorkflowRuns({ repository_path: repoA });
    expect(runs).toHaveLength(1);
    expect(runs[0].repository_path).toBe(repoA);
  });

  it("filters by worktree_branch", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();

    createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
    });
    createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
    });

    const runs = listWorkflowRuns({ worktree_branch: "feat/a" });
    expect(runs).toHaveLength(1);
    expect(runs[0].worktree_branch).toBe("feat/a");
  });
});

describe("command state execution", () => {
  const COMMAND_WORKFLOW_CONFIG = `
workflows:
  cmd-flow:
    initial_state: cleanup
    states:
      cleanup:
        command: "exit 0"
        transitions:
          - state: next
            when: succeeded
          - terminal: failure
            when: failed
      next:
        goal: "Do the next thing"
        transitions:
          - terminal: success
            when: done
`;

  function setupCommandRun(config = COMMAND_WORKFLOW_CONFIG) {
    process.env.AITM_CONFIG_PATH = writeTempConfig(config);
    const repoPath = makeFakeGitRepo();
    const worktreePath = makeFakeGitRepo();
    vi.mocked(listWorktrees).mockReturnValue([
      {
        branch: "feat/test",
        path: worktreePath,
        is_main: true,
        is_bare: false,
        head: "abc123",
      },
    ]);
    return { repoPath, worktreePath };
  }

  it("executes the command and advances to the next state on succeeded", () => {
    const { repoPath } = setupCommandRun();

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    // cleanup (exit 0 → succeeded → next) should have run synchronously
    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.current_state).toBe("next");
    expect(updatedRun?.status).toBe("running");

    const executions = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { state: string; completed_at: string | null }[];
    expect(executions).toHaveLength(2);
    expect(executions[0].state).toBe("cleanup");
    expect(executions[0].completed_at).not.toBeNull();
    expect(executions[1].state).toBe("next");
  });

  it("stores command output in command_output column", () => {
    const { repoPath } = setupCommandRun(`
workflows:
  cmd-flow:
    initial_state: greet
    states:
      greet:
        command: "echo hello"
        transitions:
          - terminal: success
            when: succeeded
`);

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const execution = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .get(run.id) as { command_output: string | null };
    expect(execution.command_output).toContain("hello");
  });

  it("uses the failed transition when command exits non-zero", () => {
    const { repoPath } = setupCommandRun(`
workflows:
  cmd-flow:
    initial_state: bad-cmd
    states:
      bad-cmd:
        command: "exit 1"
        transitions:
          - terminal: success
            when: succeeded
          - terminal: failure
            when: failed
`);

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_state).toBeNull();
  });

  it("marks the run as failure when no transition matches the exit code outcome", () => {
    const { repoPath } = setupCommandRun(`
workflows:
  cmd-flow:
    initial_state: bad-cmd
    states:
      bad-cmd:
        command: "exit 1"
        transitions:
          - terminal: success
            when: succeeded
`);

    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_state).toBeNull();
  });
});

describe("getWorkflowRun", () => {
  it("returns workflow run with state executions ordered by created_at", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const [planExec] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    completeStateExecution(planExec.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    const result = getWorkflowRun(run.id);
    expect(result).toBeDefined();
    expect(result?.id).toBe(run.id);
    expect(result?.state_executions).toHaveLength(2);
    expect(result?.state_executions[0].state).toBe("plan");
    expect(result?.state_executions[1].state).toBe("implement");
  });

  it("returns undefined for unknown id", () => {
    expect(getWorkflowRun("nonexistent")).toBeUndefined();
  });
});

describe("wait_for_input state execution", () => {
  const WAIT_FOR_INPUT_CONFIG = `
workflows:
  clarify-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - state: wait-for-clarification
            when: "needs clarification"
          - terminal: failure
            when: "blocked"
      wait-for-clarification:
        wait_for_input: true
        prompt: "The agent needs clarification before continuing."
        transitions:
          - state: plan
            when: "always"
      implement:
        goal: "Implement the plan"
        transitions:
          - terminal: success
            when: "done"
          - terminal: failure
            when: "blocked"
`;

  function setupWaitForInputRun() {
    process.env.AITM_CONFIG_PATH = writeTempConfig(WAIT_FOR_INPUT_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "clarify-flow",
    });

    // Complete plan → wait-for-clarification
    const [planExec] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    completeStateExecution(planExec.id, {
      transition: "wait-for-clarification",
      reason: "Unclear spec",
      handoff_summary: "Please clarify the scope of the feature.",
    });

    return { run, repoPath };
  }

  it("sets workflow run status to waiting_for_input when entering a wait_for_input state", () => {
    const { run } = setupWaitForInputRun();

    const updated = getWorkflowRun(run.id);
    expect(updated?.status).toBe("waiting_for_input");
    expect(updated?.current_state).toBe("wait-for-clarification");
  });

  it("creates a state execution for the wait_for_input state with no session", () => {
    const { run } = setupWaitForInputRun();

    const executions = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { state: string; completed_at: string | null }[];
    expect(executions).toHaveLength(2);
    expect(executions[1].state).toBe("wait-for-clarification");
    expect(executions[1].completed_at).toBeNull();

    const sessions = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .all(executions[1].id) as unknown[];
    expect(sessions).toHaveLength(0);
  });

  it("completeWaitForInputStateExecution advances the workflow using user input as handoff_summary", () => {
    const { run } = setupWaitForInputRun();

    const waitExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND completed_at IS NULL",
      )
      .get(run.id) as { id: string };

    completeWaitForInputStateExecution(waitExec.id, "The scope is X and Y.");

    const updated = getWorkflowRun(run.id);
    // Should have transitioned back to plan (first transition)
    expect(updated?.current_state).toBe("plan");
    expect(updated?.status).toBe("running");

    const completedExec = db
      .prepare("SELECT * FROM state_executions WHERE id = ?")
      .get(waitExec.id) as { handoff_summary: string; completed_at: string };
    expect(completedExec.handoff_summary).toBe("The scope is X and Y.");
    expect(completedExec.completed_at).not.toBeNull();
  });

  it("completeWaitForInputStateExecution includes user input in the next state's handoff context", () => {
    const { run } = setupWaitForInputRun();

    const waitExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND completed_at IS NULL",
      )
      .get(run.id) as { id: string };

    completeWaitForInputStateExecution(
      waitExec.id,
      "Clarification: focus on X.",
    );

    // The new plan execution's session goal should contain the user input
    const newPlanExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND completed_at IS NULL",
      )
      .get(run.id) as { id: string };

    const planSession = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(newPlanExec.id) as { goal: string } | undefined;

    expect(planSession?.goal).toContain("Clarification: focus on X.");
  });

  it("completeWaitForInputStateExecution throws when run is not in waiting_for_input status", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(WAIT_FOR_INPUT_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "clarify-flow",
    });

    const [planExec] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    expect(() =>
      completeWaitForInputStateExecution(planExec.id, "some input"),
    ).toThrow("not waiting for input");
  });

  it("submitWorkflowRunInput throws when run is not found", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(WAIT_FOR_INPUT_CONFIG);
    expect(() => submitWorkflowRunInput("nonexistent", "input")).toThrow(
      "not found",
    );
  });

  it("submitWorkflowRunInput throws when run is not waiting_for_input", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(WAIT_FOR_INPUT_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "clarify-flow",
    });

    expect(() => submitWorkflowRunInput(run.id, "input")).toThrow(
      "not waiting for input",
    );
  });

  it("submitWorkflowRunInput advances the run and returns updated WorkflowRunWithExecutions", () => {
    const { run } = setupWaitForInputRun();

    const result = submitWorkflowRunInput(run.id, "Here is the clarification.");

    expect(result.id).toBe(run.id);
    expect(result.status).toBe("running");
    expect(result.current_state).toBe("plan");
    expect(Array.isArray(result.state_executions)).toBe(true);
  });
});

describe("rerunWorkflowRunFromFailedState", () => {
  function setupFailedRun() {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    // Complete plan → implement
    const [planExec] = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string }[];
    completeStateExecution(planExec.id, {
      transition: "implement",
      reason: "Plan done",
      handoff_summary: "Wrote PLAN.md",
    });

    // Fail implement → failure
    const implementExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND state = 'implement'",
      )
      .get(run.id) as { id: string };
    completeStateExecution(implementExec.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    return { run, repoPath, planExec, implementExec };
  }

  it("throws for unknown run id", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    expect(() => rerunWorkflowRunFromFailedState("nonexistent")).toThrow(
      "Workflow run not found",
    );
  });

  it("throws when run is not in failure status", () => {
    process.env.AITM_CONFIG_PATH = writeTempConfig(SIMPLE_WORKFLOW_CONFIG);
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    expect(() => rerunWorkflowRunFromFailedState(run.id)).toThrow(
      "Only failed workflow runs can be re-run from failed state",
    );
  });

  it("sets workflow_run status to running and current_state to the failed state", () => {
    const { run } = setupFailedRun();

    rerunWorkflowRunFromFailedState(run.id);

    const updated = getWorkflowRun(run.id);
    expect(updated?.status).toBe("running");
    expect(updated?.current_state).toBe("implement");
  });

  it("creates a new state_execution for the failed state", () => {
    const { run, implementExec } = setupFailedRun();

    rerunWorkflowRunFromFailedState(run.id);

    const executions = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND state = 'implement' ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string }[];
    expect(executions).toHaveLength(2);
    expect(executions[1].id).not.toBe(implementExec.id);
  });

  it("passes handoff context from completed executions (excluding the failed one) to the new session", () => {
    const { run, implementExec } = setupFailedRun();

    rerunWorkflowRunFromFailedState(run.id);

    const newImplementExec = db
      .prepare(
        "SELECT * FROM state_executions WHERE workflow_run_id = ? AND state = 'implement' AND id != ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(run.id, implementExec.id) as { id: string };

    const newSession = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(newImplementExec.id) as { goal: string } | undefined;

    expect(newSession?.goal).toContain("Wrote PLAN.md");
    // The failed implement execution had handoff_summary "Could not proceed"
    // but it is the last/failed one and should be excluded
    expect(newSession?.goal).not.toContain("Could not proceed");
  });
});
