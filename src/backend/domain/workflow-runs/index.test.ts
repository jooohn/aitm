import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentService,
  sessionService,
  workflowRunService,
  worktreeService,
} from "@/backend/container";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";

const failSession = sessionService.failSession.bind(sessionService);

const {
  completeStepExecution,
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  recoverCrashedWorkflowRuns,
  rerunWorkflowRunFromFailedState,
  stopWorkflowRun,
} = {
  completeStepExecution:
    workflowRunService.completeStepExecution.bind(workflowRunService),
  createWorkflowRun:
    workflowRunService.createWorkflowRun.bind(workflowRunService),
  getWorkflowRun: workflowRunService.getWorkflowRun.bind(workflowRunService),
  listWorkflowRuns:
    workflowRunService.listWorkflowRuns.bind(workflowRunService),
  recoverCrashedWorkflowRuns:
    workflowRunService.recoverCrashedWorkflowRuns.bind(workflowRunService),
  rerunWorkflowRunFromFailedState:
    workflowRunService.rerunWorkflowRunFromFailedState.bind(workflowRunService),
  stopWorkflowRun: workflowRunService.stopWorkflowRun.bind(workflowRunService),
};

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

async function writeTempConfig(content: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  const configPath = join(dir, "config.yaml");
  await writeFile(configPath, content, "utf8");
  return configPath;
}

const SIMPLE_WORKFLOW_CONFIG = `
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
          - terminal: failure
            when: "blocked"
`;

let originalConfigPath: string | undefined;

beforeEach(() => {
  originalConfigPath = process.env.AITM_CONFIG_PATH;
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  // Prevent the background agent from running and racing with test assertions.
  vi.spyOn(agentService, "startAgent").mockResolvedValue(undefined);

  // Default mock: return a worktree matching any branch so SessionService
  // can resolve cwd when creating sessions.
  vi.spyOn(worktreeService, "listWorktrees").mockImplementation(
    async (repoPath) => [
      {
        branch: "feat/test",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
      {
        branch: "feat/a",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
      {
        branch: "feat/b",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
    ],
  );
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
  it("creates a workflow_run record in running status at initial_step", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    expect(run.id).toBeTypeOf("string");
    expect(run.repository_path).toBe(repoPath);
    expect(run.worktree_branch).toBe("feat/test");
    expect(run.workflow_name).toBe("my-flow");
    expect(run.current_step).toBe("plan");
    expect(run.status).toBe("running");
    expect(run.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("creates a session for the initial step", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
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
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { step: string }[];
    expect(executions).toHaveLength(1);
    expect(executions[0].step).toBe("plan");
  });

  it("stores output.metadata field definitions on the session for the agent", async () => {
    const configWithMetadata = `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
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
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(configWithMetadata);
    const repoPath = await makeFakeGitRepo();

    await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    // The session should store metadata_fields so the agent output schema includes them
    const session = db
      .prepare("SELECT * FROM sessions WHERE repository_path = ?")
      .get(repoPath) as { metadata_fields: string | null };
    const metadataFields = JSON.parse(session.metadata_fields!);
    expect(metadataFields).toEqual({
      pr_url: { type: "string", description: "The pull request URL" },
      pr_number: { type: "string" },
    });
  });

  it("throws when workflow is not found in config", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    await expect(() =>
      createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "nonexistent-flow",
      }),
    ).rejects.toThrow("Workflow not found");
  });

  it("stores inputs as JSON on the workflow run record", async () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(configWithInputs);
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { "feature-description": "Implement login page" },
    });

    expect(run.inputs).toBe(
      JSON.stringify({ "feature-description": "Implement login page" }),
    );
  });

  it("injects inputs into the initial session goal as an <inputs> block", async () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
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
          - terminal: failure
            when: "blocked"
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(configWithInputs);
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { "feature-description": "Implement login page" },
    });

    const planExec = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .get(run.id) as { id: string };
    const planSession = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(planExec.id) as { goal: string };

    expect(planSession.goal).toContain("<inputs>");
    expect(planSession.goal).toContain(
      "feature-description: Implement login page",
    );
    expect(planSession.goal).toContain("</inputs>");
  });

  it("resolves and passes the effective agent config for a goal step", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(`
agent:
  provider: claude
  model: sonnet
  command: /opt/homebrew/bin/claude
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        agent:
          model: sonnet-4.5
        transitions:
          - terminal: success
            when: "done"
`);
    const repoPath = await makeFakeGitRepo();
    const createSessionSpy = vi.spyOn(sessionService, "createSession");

    await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    expect(createSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        agent_config: {
          provider: "claude",
          model: "sonnet-4.5",
          command: "/opt/homebrew/bin/claude",
        },
      }),
    );
  });

  it("does not inject inputs block into subsequent step session goals", async () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
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
          - terminal: failure
            when: "blocked"
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(configWithInputs);
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { "feature-description": "Implement login page" },
    });

    const [planExec] = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string; step: string }[];

    await completeStepExecution(planExec.id, {
      transition: "implement",
      reason: "Plan done",
      handoff_summary: "Wrote PLAN.md",
    });

    const implementExec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement'",
      )
      .get(run.id) as { id: string };

    const implementSession = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(implementExec.id) as { goal: string };

    // The implement session should NOT have a raw <inputs> block
    expect(implementSession.goal).not.toContain("<inputs>");
    // But it should have the handoff context
    expect(implementSession.goal).toContain("<handoff>");
    expect(implementSession.goal).toContain("Wrote PLAN.md");
  });

  it("throws when a required input is missing", async () => {
    const configWithInputs = `
workflows:
  my-flow:
    inputs:
      feature-description:
        label: Feature Description
        required: true
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(configWithInputs);
    const repoPath = await makeFakeGitRepo();

    await expect(() =>
      createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "my-flow",
        inputs: {},
      }),
    ).rejects.toThrow("Missing required input: Feature Description");
  });

  it("emits workflow-run.status-changed with running status on creation", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "running",
    });
  });
});

describe("completeStepExecution", () => {
  async function setupRunAtPlan() {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string; step: string }[];
    return { run, execution, repoPath };
  }

  it("transitions to next step and creates a new step execution", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.current_step).toBe("implement");
    expect(updatedRun?.status).toBe("running");

    const executions = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { step: string }[];
    expect(executions).toHaveLength(2);
    const steps = executions.map((e) => e.step);
    expect(steps).toContain("plan");
    expect(steps).toContain("implement");
  });

  it("records transition_decision and handoff_summary on the completed execution", async () => {
    const { execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
    });

    const completedExecution = db
      .prepare("SELECT * FROM step_executions WHERE id = ?")
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

  it("marks workflow run as success on terminal success transition", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    // First complete plan → implement
    const [planExec] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    await completeStepExecution(planExec.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    // Then complete implement → success
    const [_, implementExec] = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string; step: string }[];
    await completeStepExecution(implementExec.id, {
      transition: "success",
      reason: "Code is done",
      handoff_summary: "All done",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("success");
    expect(updatedRun?.current_step).toBeNull();
  });

  it("marks workflow run as failure on terminal failure transition", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("plan");
  });

  it("marks workflow run as failure when transition name is not valid", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "nonexistent-state",
      reason: "??",
      handoff_summary: "",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("plan");
  });

  it("passes all previous executions as handoff context to the new session goal", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Created PLAN.md with approach",
    });

    const implementExec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement'",
      )
      .get(run.id) as { id: string };

    const implementSession = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(implementExec.id) as { goal: string };

    // implement session should contain the plan handoff
    expect(implementSession.goal).toContain("Created PLAN.md with approach");
    expect(implementSession.goal).toContain("plan");

    // Now complete implement and check the next session sees BOTH prior executions
    await completeStepExecution(implementExec.id, {
      transition: "implement",
      reason: "Still working",
      handoff_summary: "Wrote src/index.ts",
    });

    const implement2Exec = db
      .prepare(
        `SELECT * FROM step_executions
         WHERE workflow_run_id = ? AND step = 'implement' AND id != ?`,
      )
      .get(run.id, implementExec.id) as { id: string };

    const implement2Session = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(implement2Exec.id) as { goal: string };

    // Second implement session should contain BOTH prior handoffs
    expect(implement2Session.goal).toContain("Created PLAN.md with approach");
    expect(implement2Session.goal).toContain("Wrote src/index.ts");
  });

  it("stores metadata on the workflow run when the decision carries metadata", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
      metadata: { pr_url: "https://github.com/org/repo/pull/42" },
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.metadata).toBe(
      JSON.stringify({ pr_url: "https://github.com/org/repo/pull/42" }),
    );
  });

  it("merges metadata across multiple step executions", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
      metadata: { plan_status: "complete" },
    });

    // Complete implement with additional metadata
    const implementExec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement'",
      )
      .get(run.id) as { id: string };

    await completeStepExecution(implementExec.id, {
      transition: "success",
      reason: "Code is done",
      handoff_summary: "All done",
      metadata: { pr_url: "https://github.com/org/repo/pull/42" },
    });

    const updatedRun = getWorkflowRun(run.id);
    const metadata = JSON.parse(updatedRun!.metadata!);
    expect(metadata).toEqual({
      plan_status: "complete",
      pr_url: "https://github.com/org/repo/pull/42",
    });
  });

  it("does not set metadata when decision has no metadata", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.metadata).toBeNull();
  });

  it("emits workflow-run.status-changed when decision is null (no structured output)", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const { run, execution } = await setupRunAtPlan();

    const session = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(execution.id) as { id: string };
    failSession(session.id);

    await completeStepExecution(execution.id, null);

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "failure",
    });
  });

  it("emits workflow-run.status-changed on terminal success transition", async () => {
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    const [_, implementExec] = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string }[];

    const emitSpy = vi.spyOn(eventBus, "emit");

    await completeStepExecution(implementExec.id, {
      transition: "success",
      reason: "Code is done",
      handoff_summary: "All done",
    });

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "success",
    });
  });

  it("emits workflow-run.status-changed on terminal failure transition", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "failure",
    });
  });

  it("emits workflow-run.status-changed when transition name is not valid", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const { run, execution } = await setupRunAtPlan();

    await completeStepExecution(execution.id, {
      transition: "nonexistent-state",
      reason: "??",
      handoff_summary: "",
    });

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "failure",
    });
  });
});

describe("stopWorkflowRun", () => {
  async function setupRunningRun() {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const execution = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .get(run.id) as { id: string };
    const session = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(execution.id) as { id: string; status: string };

    return { run, execution, session };
  }

  it("fails the active session and marks the running workflow run as failure", async () => {
    const { run, execution, session } = await setupRunningRun();

    const stopped = await stopWorkflowRun(run.id);

    expect(stopped.status).toBe("failure");
    expect(stopped.current_step).toBe("plan");

    const updatedExecution = db
      .prepare("SELECT * FROM step_executions WHERE id = ?")
      .get(execution.id) as { completed_at: string | null };
    expect(updatedExecution.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const updatedSession = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(session.id) as { status: string };
    expect(updatedSession.status).toBe("FAILED");
  });

  it("throws when the workflow run is already terminal", async () => {
    const { run, execution } = await setupRunningRun();
    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    await expect(() => stopWorkflowRun(run.id)).rejects.toThrow(
      "Workflow run is already in a terminal state",
    );
  });

  it("throws when the active step execution has no linked session", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(`
workflows:
  my-flow:
    initial_step: run-command
    steps:
      run-command:
        command: "exit 1"
        transitions:
          - terminal: failure
            when: "failed"
`);
    const repoPath = await makeFakeGitRepo();
    vi.spyOn(worktreeService, "listWorktrees").mockResolvedValue([
      {
        branch: "feat/test",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
    ]);

    const now = new Date().toISOString();
    const runId = "running-command-run";
    const executionId = "running-command-execution";
    db.prepare(
      `INSERT INTO workflow_runs
         (id, repository_path, worktree_branch, workflow_name, current_step, status, inputs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
    ).run(runId, repoPath, "feat/test", "my-flow", "run-command", now, now);
    db.prepare(
      `INSERT INTO step_executions
         (id, workflow_run_id, step, command_output, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
    ).run(executionId, runId, "run-command", now);

    await expect(() => stopWorkflowRun(runId)).rejects.toThrow(
      "No active session to stop for this workflow run",
    );
  });

  it("still fails the workflow run when the active session already reached SUCCEEDED", async () => {
    const { run, execution, session } = await setupRunningRun();

    db.prepare("UPDATE sessions SET status = 'SUCCEEDED' WHERE id = ?").run(
      session.id,
    );

    const stopped = await stopWorkflowRun(run.id);

    expect(stopped.status).toBe("failure");
    expect(stopped.current_step).toBe("plan");

    const updatedExecution = db
      .prepare("SELECT completed_at FROM step_executions WHERE id = ?")
      .get(execution.id) as { completed_at: string | null };
    expect(updatedExecution.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("still fails the workflow run when failSession loses a race to a terminal session update", async () => {
    const { run, execution, session } = await setupRunningRun();

    vi.spyOn(sessionService, "failSession").mockImplementationOnce((id) => {
      db.prepare("UPDATE sessions SET status = 'SUCCEEDED' WHERE id = ?").run(
        id,
      );
      throw new Error(
        `Session ${id} is already in a terminal state: SUCCEEDED`,
      );
    });

    const stopped = await stopWorkflowRun(run.id);

    expect(stopped.status).toBe("failure");
    expect(stopped.current_step).toBe("plan");

    const updatedExecution = db
      .prepare("SELECT completed_at FROM step_executions WHERE id = ?")
      .get(execution.id) as { completed_at: string | null };
    expect(updatedExecution.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const updatedSession = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(session.id) as { status: string };
    expect(updatedSession.status).toBe("SUCCEEDED");
  });
});

describe("workflow run lifecycle around session startup races", () => {
  it("marks the workflow run as failure when the session is failed before agent startup continues", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const execution = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .get(run.id) as { id: string };
    const session = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(execution.id) as { id: string };

    failSession(session.id);

    // Simulate what startAgent would do when it detects the failed session:
    // it calls onComplete(null) which triggers completeStepExecution(null).
    await completeStepExecution(execution.id, null);

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("plan");

    const updatedExecution = db
      .prepare("SELECT completed_at FROM step_executions WHERE id = ?")
      .get(execution.id) as { completed_at: string | null };
    expect(updatedExecution.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("minimum workflow (single goal step, terminal-only transitions)", () => {
  const MINIMAL_WORKFLOW_CONFIG = `
workflows:
  minimal-flow:
    initial_step: goal
    steps:
      goal:
        goal: "Do the thing"
        transitions:
          - terminal: success
            when: "done"
          - terminal: failure
            when: "blocked"
`;

  it("happy path: run reaches success after completing the only step", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      MINIMAL_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "minimal-flow",
    });

    expect(run.current_step).toBe("goal");
    expect(run.status).toBe("running");

    const [exec] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    await completeStepExecution(exec.id, {
      transition: "success",
      reason: "All done",
      handoff_summary: "Finished",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("success");
    expect(updatedRun?.current_step).toBeNull();
  });
});

describe("workflow config missing `steps` key", () => {
  const NO_STATES_CONFIG = `
workflows:
  no-states-flow:
    initial_step: goal
`;

  it("createWorkflowRun throws a descriptive error instead of TypeError", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(NO_STATES_CONFIG);
    const repoPath = await makeFakeGitRepo();

    await expect(() =>
      createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "no-states-flow",
      }),
    ).rejects.toThrow("Step not found: goal");
  });

  it("completeStepExecution terminates run as failure when workflow.steps is undefined at transition time", async () => {
    // Create the run with a valid config first
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const [exec] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    // Swap to a config where my-flow exists but has no steps key
    process.env.AITM_CONFIG_PATH = await writeTempConfig(`
workflows:
  my-flow:
    initial_step: plan
`);

    // Should not throw — should terminate as failure
    await completeStepExecution(exec.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("plan");
  });
});

describe("listWorkflowRuns", () => {
  it("returns all runs ordered by created_at descending", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
    });
    await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
    });

    const runs = listWorkflowRuns({});
    expect(runs).toHaveLength(2);
  });

  it("filters by repository_path", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoA = await makeFakeGitRepo();
    const repoB = await makeFakeGitRepo();

    await createWorkflowRun({
      repository_path: repoA,
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
    });
    await createWorkflowRun({
      repository_path: repoB,
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
    });

    const runs = listWorkflowRuns({ repository_path: repoA });
    expect(runs).toHaveLength(1);
    expect(runs[0].repository_path).toBe(repoA);
  });

  it("filters by worktree_branch", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
    });
    await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
    });

    const runs = listWorkflowRuns({ worktree_branch: "feat/a" });
    expect(runs).toHaveLength(1);
    expect(runs[0].worktree_branch).toBe("feat/a");
  });
});

describe("command step execution", () => {
  const COMMAND_WORKFLOW_CONFIG = `
workflows:
  cmd-flow:
    initial_step: cleanup
    steps:
      cleanup:
        command: "exit 0"
        transitions:
          - step: next
            when: succeeded
          - terminal: failure
            when: failed
      next:
        goal: "Do the next thing"
        transitions:
          - terminal: success
            when: done
`;

  async function setupCommandRun(config = COMMAND_WORKFLOW_CONFIG) {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(config);
    const repoPath = await makeFakeGitRepo();
    const worktreePath = await makeFakeGitRepo();
    vi.spyOn(worktreeService, "listWorktrees").mockResolvedValue([
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

  it("executes the command and advances to the next step on succeeded", async () => {
    const { repoPath } = await setupCommandRun();

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.current_step).toBe("next");
    expect(updatedRun?.status).toBe("running");

    const executions = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { step: string; completed_at: string | null }[];
    expect(executions).toHaveLength(2);
    expect(executions[0].step).toBe("cleanup");
    expect(executions[0].completed_at).not.toBeNull();
    expect(executions[1].step).toBe("next");
  });

  it("stores command output in command_output column", async () => {
    const { repoPath } = await setupCommandRun(`
workflows:
  cmd-flow:
    initial_step: greet
    steps:
      greet:
        command: "echo hello"
        transitions:
          - terminal: success
            when: succeeded
`);

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const execution = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .get(run.id) as { command_output: string | null };
    expect(execution.command_output).toContain("hello");
  });

  it("uses the failed transition when command exits non-zero", async () => {
    const { repoPath } = await setupCommandRun(`
workflows:
  cmd-flow:
    initial_step: bad-cmd
    steps:
      bad-cmd:
        command: "exit 1"
        transitions:
          - terminal: success
            when: succeeded
          - terminal: failure
            when: failed
`);

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("bad-cmd");
  });

  it("marks the run as failure when no transition matches the exit code outcome", async () => {
    const { repoPath } = await setupCommandRun(`
workflows:
  cmd-flow:
    initial_step: bad-cmd
    steps:
      bad-cmd:
        command: "exit 1"
        transitions:
          - terminal: success
            when: succeeded
`);

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cmd-flow",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("bad-cmd");
  });
});

describe("getWorkflowRun", () => {
  it("returns workflow run with step executions ordered by created_at", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const [planExec] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    await completeStepExecution(planExec.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan done",
    });

    const result = getWorkflowRun(run.id);
    expect(result).toBeDefined();
    expect(result?.id).toBe(run.id);
    expect(result?.step_executions).toHaveLength(2);
    expect(result?.step_executions[0].step).toBe("plan");
    expect(result?.step_executions[1].step).toBe("implement");
  });

  it("returns undefined for unknown id", () => {
    expect(getWorkflowRun("nonexistent")).toBeUndefined();
  });
});

describe("rerunWorkflowRunFromFailedState", () => {
  async function setupFailedRun() {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    // Complete plan → implement
    const [planExec] = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string }[];
    await completeStepExecution(planExec.id, {
      transition: "implement",
      reason: "Plan done",
      handoff_summary: "Wrote PLAN.md",
    });

    // Fail implement → failure
    const implementExec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement'",
      )
      .get(run.id) as { id: string };
    await completeStepExecution(implementExec.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    return { run, repoPath, planExec, implementExec };
  }

  it("throws for unknown run id", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    await expect(() =>
      rerunWorkflowRunFromFailedState("nonexistent"),
    ).rejects.toThrow("Workflow run not found");
  });

  it("throws when run is not in failure status", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      SIMPLE_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    await expect(() => rerunWorkflowRunFromFailedState(run.id)).rejects.toThrow(
      "Only failed workflow runs can be re-run from failed state",
    );
  });

  it("sets workflow_run status to running and current_step to the failed step", async () => {
    const { run } = await setupFailedRun();

    await rerunWorkflowRunFromFailedState(run.id);

    const updated = getWorkflowRun(run.id);
    expect(updated?.status).toBe("running");
    expect(updated?.current_step).toBe("implement");
  });

  it("creates a new step_execution for the failed step", async () => {
    const { run, implementExec } = await setupFailedRun();

    await rerunWorkflowRunFromFailedState(run.id);

    const executions = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement' ORDER BY created_at ASC",
      )
      .all(run.id) as { id: string }[];
    expect(executions).toHaveLength(2);
    expect(executions[1].id).not.toBe(implementExec.id);
  });

  it("passes handoff context from completed executions (excluding the failed one) to the new session", async () => {
    const { run, implementExec } = await setupFailedRun();

    await rerunWorkflowRunFromFailedState(run.id);

    const newImplementExec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement' AND id != ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(run.id, implementExec.id) as { id: string };

    const newSession = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(newImplementExec.id) as { goal: string } | undefined;

    expect(newSession?.goal).toContain("Wrote PLAN.md");
    // The failed implement execution had handoff_summary "Could not proceed"
    // but it is the last/failed one and should be excluded
    expect(newSession?.goal).not.toContain("Could not proceed");
  });

  it("resets effective step count so max_steps guard does not block the rerun", async () => {
    // Workflow with max_steps: 4 and a non-terminal transition (implement → plan).
    // The bug: after accumulating step executions that hit the limit, re-running
    // from failed state still counts ALL past executions, so a non-terminal
    // transition gets blocked by the max_steps guard even though the user
    // explicitly chose to continue.
    const MAX_STEPS_WORKFLOW = `
workflows:
  my-flow:
    max_steps: 4
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
          - step: plan
            when: "needs re-planning"
          - terminal: success
            when: "code is done"
          - terminal: failure
            when: "blocked"
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(MAX_STEPS_WORKFLOW);
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    // createWorkflowRun created exec #1 (plan).
    // Cycle: plan→implement→plan→implement (4 execs, hitting max_steps).
    // Exec #1: plan → implement
    const exec1 = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND completed_at IS NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(run.id) as { id: string };
    await completeStepExecution(exec1.id, {
      transition: "implement",
      reason: "plan done",
      handoff_summary: "plan handoff",
    });
    // Exec #2: implement → plan (needs re-planning)
    const exec2 = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND completed_at IS NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(run.id) as { id: string };
    await completeStepExecution(exec2.id, {
      transition: "plan",
      reason: "needs re-planning",
      handoff_summary: "re-plan",
    });
    // Exec #3: plan → implement
    const exec3 = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND completed_at IS NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(run.id) as { id: string };
    await completeStepExecution(exec3.id, {
      transition: "implement",
      reason: "plan done again",
      handoff_summary: "plan handoff 2",
    });
    // Exec #4: implement — count is now 4 = max_steps. Any non-terminal
    // transition would be blocked. Force a terminal failure to end the run.
    const exec4 = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND completed_at IS NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(run.id) as { id: string };
    await completeStepExecution(exec4.id, {
      transition: "failure",
      reason: "blocked",
      handoff_summary: "failed",
    });
    expect(getWorkflowRun(run.id)?.status).toBe("failure");

    // Now re-run from failed state. The total step count is 4 (= max_steps).
    // The re-run creates exec #5 for "implement". Without the fix, any
    // non-terminal transition from exec #5 would see count=5 ≥ max_steps=4
    // and terminate. With the fix, the effective count resets.
    await rerunWorkflowRunFromFailedState(run.id);
    const exec5 = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND completed_at IS NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(run.id) as { id: string };
    // Transition to "plan" — a non-terminal step transition.
    // Without the fix this would be blocked by max_steps.
    await completeStepExecution(exec5.id, {
      transition: "plan",
      reason: "needs re-planning",
      handoff_summary: "re-plan after rerun",
    });

    const afterRerun = getWorkflowRun(run.id);
    // The workflow should still be running, having advanced to "plan".
    expect(afterRerun?.status).toBe("running");
    expect(afterRerun?.current_step).toBe("plan");
  });

  it("emits workflow-run.status-changed with running status on rerun", async () => {
    const { run } = await setupFailedRun();
    const emitSpy = vi.spyOn(eventBus, "emit");

    await rerunWorkflowRunFromFailedState(run.id);

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "running",
    });
  });
});

describe("max steps safe guard", () => {
  const CYCLING_WORKFLOW_CONFIG = `
workflows:
  cycling-flow:
    initial_step: step_a
    steps:
      step_a:
        goal: "Do step A"
        transitions:
          - step: step_b
            when: "done"
          - terminal: failure
            when: "blocked"
      step_b:
        goal: "Do step B"
        transitions:
          - step: step_a
            when: "loop back"
          - terminal: success
            when: "done"
          - terminal: failure
            when: "blocked"
`;

  const CYCLING_WORKFLOW_WITH_MAX_STEPS_CONFIG = `
workflows:
  cycling-flow:
    max_steps: 5
    initial_step: step_a
    steps:
      step_a:
        goal: "Do step A"
        transitions:
          - step: step_b
            when: "done"
          - terminal: failure
            when: "blocked"
      step_b:
        goal: "Do step B"
        transitions:
          - step: step_a
            when: "loop back"
          - terminal: success
            when: "done"
          - terminal: failure
            when: "blocked"
`;

  async function setupCyclingRun(config: string) {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(config);
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "cycling-flow",
    });
    return { run, repoPath };
  }

  async function advanceOneStep(workflowRunId: string, nextStep: string) {
    const exec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND completed_at IS NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(workflowRunId) as { id: string };
    await completeStepExecution(exec.id, {
      transition: nextStep,
      reason: "continuing",
      handoff_summary: "handoff",
    });
  }

  it("terminates workflow run as failure when step count reaches the default limit of 30", async () => {
    const { run } = await setupCyclingRun(CYCLING_WORKFLOW_CONFIG);

    // The initial createWorkflowRun already created 1 step execution (step_a).
    // We need to cycle through steps until we hit the limit of 30.
    // Each advanceOneStep completes the current execution and starts a new one.
    // The guard checks count before starting a new execution, so we need 30
    // completed transitions for count to reach 30 and trigger the guard.
    for (let i = 0; i < 30; i++) {
      const currentRun = getWorkflowRun(run.id);
      if (currentRun?.status !== "running") break;
      const nextStep =
        currentRun?.current_step === "step_a" ? "step_b" : "step_a";
      await advanceOneStep(run.id, nextStep);
    }

    const finalRun = getWorkflowRun(run.id);
    expect(finalRun?.status).toBe("failure");
  });

  it("respects per-workflow max_steps override", async () => {
    const { run } = await setupCyclingRun(
      CYCLING_WORKFLOW_WITH_MAX_STEPS_CONFIG,
    );

    // max_steps is 5, so after 5 transitions the guard triggers (count reaches 5).
    for (let i = 0; i < 5; i++) {
      const currentRun = getWorkflowRun(run.id);
      if (currentRun?.status !== "running") break;
      const nextStep =
        currentRun?.current_step === "step_a" ? "step_b" : "step_a";
      await advanceOneStep(run.id, nextStep);
    }

    const finalRun = getWorkflowRun(run.id);
    expect(finalRun?.status).toBe("failure");
  });

  it("allows workflow to complete normally when under the limit", async () => {
    const { run } = await setupCyclingRun(
      CYCLING_WORKFLOW_WITH_MAX_STEPS_CONFIG,
    );

    // Advance step_a -> step_b, then step_b -> success (2 total executions, under limit of 5)
    await advanceOneStep(run.id, "step_b");
    await advanceOneStep(run.id, "success");

    const finalRun = getWorkflowRun(run.id);
    expect(finalRun?.status).toBe("success");
  });

  it("emits workflow-run.status-changed when max steps exceeded", async () => {
    const { run } = await setupCyclingRun(
      CYCLING_WORKFLOW_WITH_MAX_STEPS_CONFIG,
    );

    const emitSpy = vi.spyOn(eventBus, "emit");

    // max_steps is 5, so after 5 transitions the guard triggers.
    for (let i = 0; i < 5; i++) {
      const currentRun = getWorkflowRun(run.id);
      if (currentRun?.status !== "running") break;
      const nextStep =
        currentRun?.current_step === "step_a" ? "step_b" : "step_a";
      await advanceOneStep(run.id, nextStep);
    }

    expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
      workflowRunId: run.id,
      status: "failure",
    });
  });
});

describe("manual-approval step execution", () => {
  const APPROVAL_WORKFLOW_CONFIG = `
workflows:
  approval-flow:
    initial_step: review
    steps:
      review:
        type: manual-approval
        transitions:
          - step: deploy
            when: approved
          - terminal: failure
            when: rejected
      deploy:
        goal: "Deploy the code"
        transitions:
          - terminal: success
            when: done
`;

  async function setupApprovalRun(config = APPROVAL_WORKFLOW_CONFIG) {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(config);
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });
    return { run, repoPath };
  }

  it("creates a step execution with step_type 'manual-approval' and no session", async () => {
    const { run } = await setupApprovalRun();

    expect(run.status).toBe("awaiting");
    expect(run.current_step).toBe("review");

    const executions = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as {
      step: string;
      step_type: string;
      completed_at: string | null;
    }[];
    expect(executions).toHaveLength(1);
    expect(executions[0].step).toBe("review");
    expect(executions[0].step_type).toBe("manual-approval");
    expect(executions[0].completed_at).toBeNull();

    // No session should be created for manual-approval steps
    const sessions = db
      .prepare(
        `SELECT * FROM sessions s
         JOIN step_executions se ON s.step_execution_id = se.id
         WHERE se.workflow_run_id = ?`,
      )
      .all(run.id) as unknown[];
    expect(sessions).toHaveLength(0);
  });

  it("goes through the normal findWorktree path like other step types", async () => {
    const findWorktreeSpy = vi.spyOn(worktreeService, "findWorktree");
    await setupApprovalRun();

    expect(findWorktreeSpy).toHaveBeenCalledOnce();
  });

  it("emits step-execution.awaiting-approval event", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const { run } = await setupApprovalRun();

    const executions = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    expect(emitSpy).toHaveBeenCalledWith("step-execution.awaiting-approval", {
      stepExecutionId: executions[0].id,
      workflowRunId: run.id,
    });
  });

  it("transitions to next step when completed with 'approved' decision", async () => {
    const { run } = await setupApprovalRun();

    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    await completeStepExecution(execution.id, {
      transition: "deploy",
      reason: "Manually approved",
      handoff_summary: "",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.current_step).toBe("deploy");
    expect(updatedRun?.status).toBe("running");

    const executions = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
      )
      .all(run.id) as { step: string; completed_at: string | null }[];
    expect(executions).toHaveLength(2);
    expect(executions[0].step).toBe("review");
    expect(executions[0].completed_at).not.toBeNull();
    expect(executions[1].step).toBe("deploy");
  });

  it("terminates as failure when completed with 'rejected' decision", async () => {
    const { run } = await setupApprovalRun();

    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Manually rejected",
      handoff_summary: "",
    });

    const updatedRun = getWorkflowRun(run.id);
    expect(updatedRun?.status).toBe("failure");
    expect(updatedRun?.current_step).toBe("review");
  });

  it("works as an intermediate step in a multi-step workflow", async () => {
    const multiStepConfig = `
workflows:
  approval-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - step: review
            when: "plan is ready"
      review:
        type: manual-approval
        transitions:
          - step: deploy
            when: approved
          - terminal: failure
            when: rejected
      deploy:
        goal: "Deploy the code"
        transitions:
          - terminal: success
            when: done
`;
    process.env.AITM_CONFIG_PATH = await writeTempConfig(multiStepConfig);
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });

    // Complete plan → review
    const [planExec] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    await completeStepExecution(planExec.id, {
      transition: "review",
      reason: "Plan done",
      handoff_summary: "Wrote PLAN.md",
    });

    const afterPlan = getWorkflowRun(run.id);
    expect(afterPlan?.current_step).toBe("review");
    expect(afterPlan?.status).toBe("awaiting");

    // The review step should be manual-approval with no session
    const reviewExec = db
      .prepare(
        "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'review'",
      )
      .get(run.id) as {
      id: string;
      step_type: string;
      completed_at: string | null;
    };
    expect(reviewExec.step_type).toBe("manual-approval");
    expect(reviewExec.completed_at).toBeNull();

    // Approve → deploy
    await completeStepExecution(reviewExec.id, {
      transition: "deploy",
      reason: "Manually approved",
      handoff_summary: "",
    });

    const afterApproval = getWorkflowRun(run.id);
    expect(afterApproval?.current_step).toBe("deploy");
    expect(afterApproval?.status).toBe("running");
  });
});

describe("recovery does not fail pending manual-approval executions", () => {
  const APPROVAL_WORKFLOW_CONFIG = `
workflows:
  approval-flow:
    initial_step: review
    steps:
      review:
        type: manual-approval
        transitions:
          - step: deploy
            when: approved
          - terminal: failure
            when: rejected
      deploy:
        goal: "Deploy the code"
        transitions:
          - terminal: success
            when: done
`;

  it("does not fail a workflow run with a pending manual-approval step on recovery", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      APPROVAL_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });

    // Verify the run is in awaiting state with a pending manual-approval execution
    expect(run.status).toBe("awaiting");
    expect(run.current_step).toBe("review");

    // Run recovery — it should NOT fail the pending manual-approval execution
    await recoverCrashedWorkflowRuns();

    const recoveredRun = getWorkflowRun(run.id);
    expect(recoveredRun?.status).toBe("awaiting");
    expect(recoveredRun?.current_step).toBe("review");

    // The execution should still be pending (not completed)
    const executions = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { completed_at: string | null }[];
    expect(executions).toHaveLength(1);
    expect(executions[0].completed_at).toBeNull();
  });

  it("fails when the worktree does not exist", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(
      APPROVAL_WORKFLOW_CONFIG,
    );
    const repoPath = await makeFakeGitRepo();

    // Override mock to return no worktrees for this branch
    vi.spyOn(worktreeService, "listWorktrees").mockResolvedValueOnce([]);

    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/no-worktree",
      workflow_name: "approval-flow",
    });

    // Without a worktree, the workflow should fail like any other step type
    expect(run.status).toBe("failure");
  });
});

describe("awaiting status", () => {
  const APPROVAL_WORKFLOW_CONFIG = `
workflows:
  approval-flow:
    initial_step: review
    steps:
      review:
        type: manual-approval
        transitions:
          - step: deploy
            when: approved
          - terminal: failure
            when: rejected
      deploy:
        goal: "Deploy the code"
        transitions:
          - terminal: success
            when: done
`;

  const MULTI_STEP_WITH_APPROVAL = `
workflows:
  approval-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - step: review
            when: "plan is ready"
      review:
        type: manual-approval
        transitions:
          - step: deploy
            when: approved
          - terminal: failure
            when: rejected
      deploy:
        goal: "Deploy the code"
        transitions:
          - terminal: success
            when: done
`;

  describe("manual-approval sets workflow run to awaiting", () => {
    it("sets workflow run status to 'awaiting' when manual-approval step starts", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      expect(run.status).toBe("awaiting");
      expect(run.current_step).toBe("review");
    });

    it("sets workflow run status to 'awaiting' when transitioning to a manual-approval step", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        MULTI_STEP_WITH_APPROVAL,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      // Complete plan → review (manual-approval)
      const [planExec] = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .all(run.id) as { id: string }[];
      await completeStepExecution(planExec.id, {
        transition: "review",
        reason: "Plan done",
        handoff_summary: "Wrote PLAN.md",
      });

      const updatedRun = getWorkflowRun(run.id);
      expect(updatedRun?.status).toBe("awaiting");
      expect(updatedRun?.current_step).toBe("review");
    });

    it("emits workflow-run.status-changed event with 'awaiting' when manual-approval starts", async () => {
      const emitSpy = vi.spyOn(eventBus, "emit");
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
        workflowRunId: run.id,
        status: "awaiting",
      });
    });
  });

  describe("agent session AWAITING_INPUT sets workflow run to awaiting", () => {
    it("sets workflow run status to 'awaiting' when agent session enters AWAITING_INPUT", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        SIMPLE_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "my-flow",
      });

      // Find the session created for the initial step
      const execution = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .get(run.id) as { id: string };
      const session = db
        .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
        .get(execution.id) as { id: string };

      // Simulate session entering AWAITING_INPUT
      db.prepare(
        "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
      ).run(session.id);
      eventBus.emit("session.status-changed", {
        sessionId: session.id,
        status: "AWAITING_INPUT",
      });

      const updatedRun = getWorkflowRun(run.id);
      expect(updatedRun?.status).toBe("awaiting");
    });

    it("emits workflow-run.status-changed event when agent session enters AWAITING_INPUT", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        SIMPLE_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "my-flow",
      });

      const execution = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .get(run.id) as { id: string };
      const session = db
        .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
        .get(execution.id) as { id: string };

      const emitSpy = vi.spyOn(eventBus, "emit");

      db.prepare(
        "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
      ).run(session.id);
      eventBus.emit("session.status-changed", {
        sessionId: session.id,
        status: "AWAITING_INPUT",
      });

      expect(emitSpy).toHaveBeenCalledWith("workflow-run.status-changed", {
        workflowRunId: run.id,
        status: "awaiting",
      });
    });

    it("sets workflow run back to 'running' when agent session resumes from AWAITING_INPUT", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        SIMPLE_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "my-flow",
      });

      const execution = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .get(run.id) as { id: string };
      const session = db
        .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
        .get(execution.id) as { id: string };

      // Go to AWAITING_INPUT
      db.prepare(
        "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
      ).run(session.id);
      eventBus.emit("session.status-changed", {
        sessionId: session.id,
        status: "AWAITING_INPUT",
      });

      expect(getWorkflowRun(run.id)?.status).toBe("awaiting");

      // Resume to RUNNING
      db.prepare("UPDATE sessions SET status = 'RUNNING' WHERE id = ?").run(
        session.id,
      );
      eventBus.emit("session.status-changed", {
        sessionId: session.id,
        status: "RUNNING",
      });

      expect(getWorkflowRun(run.id)?.status).toBe("running");
    });

    it("does not change status for sessions not linked to a workflow run", async () => {
      // Create a standalone session not linked to any workflow
      const repoPath = await makeFakeGitRepo();
      const standaloneSessionId = "standalone-session";
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO sessions (id, repository_path, worktree_branch, goal, transitions, status, log_file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'RUNNING', '/tmp/log', ?, ?)`,
      ).run(
        standaloneSessionId,
        repoPath,
        "feat/test",
        "Some goal",
        "[]",
        now,
        now,
      );

      // Should not throw
      eventBus.emit("session.status-changed", {
        sessionId: standaloneSessionId,
        status: "AWAITING_INPUT",
      });
    });
  });

  describe("resolving approval resets status", () => {
    it("resets status from 'awaiting' to 'running' when approval advances to next step", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      expect(getWorkflowRun(run.id)?.status).toBe("awaiting");

      // Approve → should transition to deploy and set status to running
      const [execution] = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .all(run.id) as { id: string }[];

      await completeStepExecution(execution.id, {
        transition: "deploy",
        reason: "Manually approved",
        handoff_summary: "",
      });

      const updatedRun = getWorkflowRun(run.id);
      expect(updatedRun?.status).toBe("running");
      expect(updatedRun?.current_step).toBe("deploy");
    });

    it("sets status to failure when approval is rejected", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      expect(getWorkflowRun(run.id)?.status).toBe("awaiting");

      const [execution] = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .all(run.id) as { id: string }[];

      await completeStepExecution(execution.id, {
        transition: "failure",
        reason: "Manually rejected",
        handoff_summary: "",
      });

      const updatedRun = getWorkflowRun(run.id);
      expect(updatedRun?.status).toBe("failure");
    });
  });

  describe("stopWorkflowRun with awaiting status", () => {
    it("allows stopping a workflow run with 'awaiting' status that has an active session", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        SIMPLE_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "my-flow",
      });

      const execution = db
        .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
        .get(run.id) as { id: string };
      const session = db
        .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
        .get(execution.id) as { id: string };

      // Simulate session entering AWAITING_INPUT → workflow goes to awaiting
      db.prepare(
        "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
      ).run(session.id);
      eventBus.emit("session.status-changed", {
        sessionId: session.id,
        status: "AWAITING_INPUT",
      });

      expect(getWorkflowRun(run.id)?.status).toBe("awaiting");

      const stopped = await stopWorkflowRun(run.id);
      expect(stopped.status).toBe("failure");
    });
  });

  describe("recovery with awaiting status", () => {
    it("does not fail workflow runs with 'awaiting' status during recovery", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      const run = await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      expect(getWorkflowRun(run.id)?.status).toBe("awaiting");

      // Run recovery — awaiting runs should NOT be failed
      await recoverCrashedWorkflowRuns();

      const recoveredRun = getWorkflowRun(run.id);
      expect(recoveredRun?.status).toBe("awaiting");
      expect(recoveredRun?.current_step).toBe("review");
    });
  });

  describe("listWorkflowRuns with awaiting status filter", () => {
    it("filters workflow runs by 'awaiting' status", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      const awaitingRuns = listWorkflowRuns({ status: "awaiting" });
      expect(awaitingRuns).toHaveLength(1);
      expect(awaitingRuns[0].status).toBe("awaiting");

      const runningRuns = listWorkflowRuns({ status: "running" });
      expect(runningRuns).toHaveLength(0);
    });
  });

  describe("pending approvals query with awaiting status", () => {
    it("listPendingApprovals matches workflow runs with 'awaiting' status", async () => {
      process.env.AITM_CONFIG_PATH = await writeTempConfig(
        APPROVAL_WORKFLOW_CONFIG,
      );
      const repoPath = await makeFakeGitRepo();
      await createWorkflowRun({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        workflow_name: "approval-flow",
      });

      const approvals = workflowRunService.listPendingApprovals();
      expect(approvals).toHaveLength(1);
    });
  });
});
