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

const failSession = sessionService.failSession.bind(sessionService);

const {
  completeStepExecution,
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
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
});
