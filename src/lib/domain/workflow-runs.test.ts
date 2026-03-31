import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../infra/db";
import {
  completeStateExecution,
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
} from "./workflow-runs";

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
  db.prepare("DELETE FROM state_executions").run();
  db.prepare("DELETE FROM session_messages").run();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM workflow_runs").run();
});

afterEach(() => {
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
      .get(run.id) as { session_id: string };
    const planSession = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(planExec.session_id) as { goal: string };

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
      .get(run.id) as { session_id: string };

    const implementSession = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(implementExec.session_id) as { goal: string };

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
      .get(run.id) as { session_id: string; id: string };

    const implementSession = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(implementExec.session_id) as { goal: string };

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
      .get(run.id, implementExec.id) as { session_id: string };

    const implement2Session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(implement2Exec.session_id) as { goal: string };

    // Second implement session should contain BOTH prior handoffs
    expect(implement2Session.goal).toContain("Created PLAN.md with approach");
    expect(implement2Session.goal).toContain("Wrote src/index.ts");
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
