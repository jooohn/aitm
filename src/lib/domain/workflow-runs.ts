import { execFileSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { getConfigWorkflows, type WorkflowTransition } from "../infra/config";
import { db } from "../infra/db";
import { type TransitionDecision } from "../utils/agent";
import { createSession } from "./sessions";
import { listWorktrees } from "./worktrees";

export type WorkflowRunStatus = "running" | "success" | "failure";

export interface WorkflowRun {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_state: string | null;
  status: WorkflowRunStatus;
  inputs: string | null;
  created_at: string;
  updated_at: string;
}

export interface StateExecution {
  id: string;
  workflow_run_id: string;
  state: string;
  command_output: string | null;
  session_status: string | null;
  transition_decision: string | null;
  handoff_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkflowRunWithExecutions extends WorkflowRun {
  state_executions: StateExecution[];
}

export interface CreateWorkflowRunInput {
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  inputs?: Record<string, string>;
}

export interface ListWorkflowRunsFilter {
  repository_path?: string;
  worktree_branch?: string;
  status?: WorkflowRunStatus;
}

type PreviousExecutionHandoff = {
  state: string;
  handoff_summary: string;
  log_file_path: string | null;
};

function buildGoal(
  stateGoal: string,
  previousExecutions: PreviousExecutionHandoff[],
  inputs?: Record<string, string>,
): string {
  const parts = ["<goal>", stateGoal, "</goal>"];

  if (
    previousExecutions.length === 0 &&
    inputs &&
    Object.keys(inputs).length > 0
  ) {
    parts.push("", "<inputs>");
    for (const [key, value] of Object.entries(inputs)) {
      parts.push(`${key}: ${value}`);
    }
    parts.push("</inputs>");
  }

  if (previousExecutions.length > 0) {
    parts.push("", "<handoff>", "Previous states (oldest first):", "");
    for (const prev of previousExecutions) {
      parts.push(`State: ${prev.state}`, `Summary: ${prev.handoff_summary}`);
      if (prev.log_file_path) {
        parts.push(`Log: ${prev.log_file_path}`);
      }
      parts.push("");
    }
    parts.push("</handoff>");
  }

  return parts.join("\n");
}

function startStateExecution(
  workflowRunId: string,
  stateName: string,
  repositoryPath: string,
  worktreeBranch: string,
  workflowName: string,
  previousExecutions: PreviousExecutionHandoff[],
  inputs?: Record<string, string>,
): StateExecution {
  const workflows = getConfigWorkflows();
  const workflow = workflows[workflowName];
  if (!workflow) throw new Error(`Workflow not found: ${workflowName}`);

  const stateDef = workflow.states[stateName];
  if (!stateDef) throw new Error(`State not found: ${stateName}`);

  const executionId = randomUUID();
  const now = new Date().toISOString();

  if ("command" in stateDef) {
    db.prepare(
      `INSERT INTO state_executions
         (id, workflow_run_id, state, command_output, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
    ).run(executionId, workflowRunId, stateName, now);

    let worktreePath: string | undefined;
    try {
      worktreePath = listWorktrees(repositoryPath).find(
        (w) => w.branch === worktreeBranch,
      )?.path;
    } catch {
      // Worktree lookup failed — will be treated as no-path below.
    }

    if (!worktreePath) {
      completeStateExecution(executionId, null);
      return db
        .prepare("SELECT * FROM state_executions WHERE id = ?")
        .get(executionId) as StateExecution;
    }

    const result = spawnSync("sh", ["-c", stateDef.command], {
      cwd: worktreePath,
      encoding: "utf8",
    });
    const commandOutput =
      [result.stdout, result.stderr].filter(Boolean).join("\n") || null;
    const outcome = result.status === 0 ? "succeeded" : "failed";

    db.prepare(
      "UPDATE state_executions SET command_output = ? WHERE id = ?",
    ).run(commandOutput, executionId);

    const matchedTransition = stateDef.transitions.find(
      (t) => t.when === outcome,
    );

    let decision: TransitionDecision | null;
    if (!matchedTransition) {
      decision = null;
    } else {
      const transitionName =
        "state" in matchedTransition
          ? matchedTransition.state
          : matchedTransition.terminal;
      decision = {
        transition: transitionName,
        reason: `exit code ${result.status ?? "unknown"}`,
        handoff_summary: commandOutput ?? "",
      };
    }

    completeStateExecution(executionId, decision);
    return db
      .prepare("SELECT * FROM state_executions WHERE id = ?")
      .get(executionId) as StateExecution;
  }

  // Goal state path.
  const goal = buildGoal(stateDef.goal, previousExecutions, inputs);

  db.prepare(
    `INSERT INTO state_executions
       (id, workflow_run_id, state, command_output, transition_decision, handoff_summary, created_at, completed_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
  ).run(executionId, workflowRunId, stateName, now);

  createSession(
    {
      repository_path: repositoryPath,
      worktree_branch: worktreeBranch,
      goal,
      transitions: stateDef.transitions as WorkflowTransition[],
      state_execution_id: executionId,
    },
    (decision) => {
      completeStateExecution(executionId, decision);
    },
  );

  return db
    .prepare("SELECT * FROM state_executions WHERE id = ?")
    .get(executionId) as StateExecution;
}

export function createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
  const workflows = getConfigWorkflows();
  const workflow = workflows[input.workflow_name];
  if (!workflow) throw new Error(`Workflow not found: ${input.workflow_name}`);

  // Validate required inputs.
  if (workflow.inputs) {
    for (const inputDef of workflow.inputs) {
      const required = inputDef.required !== false; // default true
      if (required) {
        const value = input.inputs?.[inputDef.name];
        if (!value || value.trim() === "") {
          throw new Error(
            `Missing required input: ${inputDef.label ?? inputDef.name}`,
          );
        }
      }
    }
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const inputsJson = input.inputs ? JSON.stringify(input.inputs) : null;

  db.prepare(
    `INSERT INTO workflow_runs
       (id, repository_path, worktree_branch, workflow_name, current_state, status, inputs, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
  ).run(
    id,
    input.repository_path,
    input.worktree_branch,
    input.workflow_name,
    workflow.initial_state,
    inputsJson,
    now,
    now,
  );

  startStateExecution(
    id,
    workflow.initial_state,
    input.repository_path,
    input.worktree_branch,
    input.workflow_name,
    [],
    input.inputs,
  );

  return db
    .prepare("SELECT * FROM workflow_runs WHERE id = ?")
    .get(id) as WorkflowRun;
}

export function completeStateExecution(
  stateExecutionId: string,
  decision: TransitionDecision | null,
): void {
  const execution = db
    .prepare("SELECT * FROM state_executions WHERE id = ?")
    .get(stateExecutionId) as StateExecution | undefined;
  if (!execution) return;

  const run = db
    .prepare("SELECT * FROM workflow_runs WHERE id = ?")
    .get(execution.workflow_run_id) as WorkflowRun | undefined;
  if (!run || run.status !== "running") return;

  const now = new Date().toISOString();

  // Record transition decision on the execution.
  db.prepare(
    `UPDATE state_executions SET transition_decision = ?, handoff_summary = ?, completed_at = ? WHERE id = ?`,
  ).run(
    decision ? JSON.stringify(decision) : null,
    decision?.handoff_summary ?? null,
    now,
    stateExecutionId,
  );

  if (!decision) {
    // No structured output → mark as failure.
    terminateRun(run.id, "failure", now);
    return;
  }

  const { transition } = decision;

  if (transition === "success" || transition === "failure") {
    terminateRun(run.id, transition, now);
    return;
  }

  // Look up the workflow definition to validate the next state exists.
  const workflows = getConfigWorkflows();
  const workflow = workflows[run.workflow_name];
  if (!workflow || !workflow.states[transition]) {
    terminateRun(run.id, "failure", now);
    return;
  }

  // Advance to next state.
  db.prepare(
    "UPDATE workflow_runs SET current_state = ?, updated_at = ? WHERE id = ?",
  ).run(transition, now, run.id);

  // Collect all completed executions (including the current one, now committed) for handoff.
  const previousExecutions = (
    db
      .prepare(
        `SELECT se.state, se.handoff_summary, s.log_file_path
         FROM state_executions se
         LEFT JOIN sessions s ON s.state_execution_id = se.id
         WHERE se.workflow_run_id = ? AND se.completed_at IS NOT NULL
         ORDER BY se.created_at ASC`,
      )
      .all(run.id) as Array<{
      state: string;
      handoff_summary: string | null;
      log_file_path: string | null;
    }>
  ).filter((e): e is PreviousExecutionHandoff => e.handoff_summary !== null);

  startStateExecution(
    run.id,
    transition,
    run.repository_path,
    run.worktree_branch,
    run.workflow_name,
    previousExecutions,
  );
}

function terminateRun(
  runId: string,
  terminal: "success" | "failure",
  now: string,
): void {
  db.prepare(
    "UPDATE workflow_runs SET status = ?, current_state = NULL, updated_at = ? WHERE id = ?",
  ).run(terminal, now, runId);
}

// Mark state_executions as completed where the session has reached a terminal
// state but the execution was never closed (e.g., due to a server crash).
// Then fail any workflow runs that have no remaining active state execution.
export function recoverCrashedWorkflowRuns(): void {
  const now = new Date().toISOString();

  // For uncompleted state executions whose session SUCCEEDED: replay completeStateExecution()
  // so the workflow advances (or terminates) correctly using the session's decision.
  // This handles the case where the server crashed after the session completed but before
  // the onComplete callback was invoked.
  const pendingSucceeded = db
    .prepare(
      `SELECT se.id as execution_id, s.transition_decision
       FROM state_executions se
       JOIN sessions s ON s.state_execution_id = se.id
       WHERE se.completed_at IS NULL AND s.status = 'SUCCEEDED'`,
    )
    .all() as Array<{
    execution_id: string;
    transition_decision: string | null;
  }>;

  for (const { execution_id, transition_decision } of pendingSucceeded) {
    let decision: TransitionDecision | null = null;
    if (transition_decision) {
      try {
        decision = JSON.parse(transition_decision) as TransitionDecision;
      } catch {
        // malformed JSON — treat as no decision, will terminate as failure
      }
    }
    completeStateExecution(execution_id, decision);
  }

  // For uncompleted state executions whose session FAILED while the workflow is still running:
  // close the failed execution and retry the same state with a new session.
  const pendingFailed = db
    .prepare(
      `SELECT se.id as execution_id, se.state, se.workflow_run_id
       FROM state_executions se
       JOIN sessions s ON s.state_execution_id = se.id
       JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE se.completed_at IS NULL AND s.status = 'FAILED' AND wr.status = 'running'`,
    )
    .all() as Array<{
    execution_id: string;
    state: string;
    workflow_run_id: string;
  }>;

  for (const { execution_id, state, workflow_run_id } of pendingFailed) {
    db.prepare("UPDATE state_executions SET completed_at = ? WHERE id = ?").run(
      now,
      execution_id,
    );

    const run = db
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(workflow_run_id) as WorkflowRun;

    const previousExecutions = (
      db
        .prepare(
          `SELECT se.state, se.handoff_summary, s.log_file_path
           FROM state_executions se
           LEFT JOIN sessions s ON s.state_execution_id = se.id
           WHERE se.workflow_run_id = ? AND se.completed_at IS NOT NULL
           ORDER BY se.created_at ASC`,
        )
        .all(workflow_run_id) as Array<{
        state: string;
        handoff_summary: string | null;
        log_file_path: string | null;
      }>
    ).filter((e): e is PreviousExecutionHandoff => e.handoff_summary !== null);

    const inputs = run.inputs
      ? (JSON.parse(run.inputs) as Record<string, string>)
      : undefined;

    startStateExecution(
      workflow_run_id,
      state,
      run.repository_path,
      run.worktree_branch,
      run.workflow_name,
      previousExecutions,
      inputs,
    );
  }

  // Fail workflow runs with uncompleted command state executions (no linked session).
  // These indicate a server crash during synchronous command execution.
  const orphanedCommandExecutions = db
    .prepare(
      `SELECT se.id as execution_id, se.workflow_run_id
       FROM state_executions se
       JOIN workflow_runs wr ON se.workflow_run_id = wr.id
       WHERE se.completed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM sessions WHERE state_execution_id = se.id)
         AND wr.status = 'running'`,
    )
    .all() as Array<{ execution_id: string; workflow_run_id: string }>;

  for (const { execution_id, workflow_run_id } of orphanedCommandExecutions) {
    db.prepare("UPDATE state_executions SET completed_at = ? WHERE id = ?").run(
      now,
      execution_id,
    );
    terminateRun(workflow_run_id, "failure", now);
  }

  // Close any remaining uncompleted state executions (workflow already terminated).
  db.prepare(
    `UPDATE state_executions
     SET completed_at = ?
     WHERE completed_at IS NULL
       AND id IN (
         SELECT state_execution_id FROM sessions WHERE status = 'FAILED' AND state_execution_id IS NOT NULL
       )`,
  ).run(now);

  // Fail any workflow runs that still have no active state execution.
  db.prepare(
    `UPDATE workflow_runs
     SET status = 'failure', current_state = NULL, updated_at = ?
     WHERE status = 'running'
       AND id NOT IN (
         SELECT workflow_run_id FROM state_executions WHERE completed_at IS NULL
       )`,
  ).run(now);
}

export function listWorkflowRuns(
  filter: ListWorkflowRunsFilter,
): WorkflowRun[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.repository_path !== undefined) {
    conditions.push("repository_path = ?");
    params.push(filter.repository_path);
  }
  if (filter.worktree_branch !== undefined) {
    conditions.push("worktree_branch = ?");
    params.push(filter.worktree_branch);
  }
  if (filter.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY created_at DESC`)
    .all(...params) as WorkflowRun[];
}

export function rerunWorkflowRun(id: string): WorkflowRun {
  const run = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
    | WorkflowRun
    | undefined;
  if (!run) throw new Error("Workflow run not found");

  if (run.status !== "failure") {
    throw new Error("Only failed workflow runs can be re-run");
  }

  const worktrees = listWorktrees(run.repository_path);
  const worktree = worktrees.find((w) => w.branch === run.worktree_branch);
  if (!worktree) {
    throw new Error(`Worktree not found for branch: ${run.worktree_branch}`);
  }

  try {
    execFileSync("git", ["stash", "--include-untracked"], {
      cwd: worktree.path,
      encoding: "utf8",
    });
  } catch (err) {
    // Non-zero exit from git stash is non-blocking — log a warning and continue.
    console.warn(
      "git stash warning:",
      err instanceof Error ? err.message : err,
    );
  }

  const inputs = run.inputs
    ? (JSON.parse(run.inputs) as Record<string, string>)
    : undefined;

  return createWorkflowRun({
    repository_path: run.repository_path,
    worktree_branch: run.worktree_branch,
    workflow_name: run.workflow_name,
    inputs,
  });
}

export function getWorkflowRun(
  id: string,
): WorkflowRunWithExecutions | undefined {
  const run = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
    | WorkflowRun
    | undefined;
  if (!run) return undefined;

  const state_executions = db
    .prepare(
      `SELECT se.*, s.status as session_status
       FROM state_executions se
       LEFT JOIN sessions s ON se.session_id = s.id
       WHERE se.workflow_run_id = ?
       ORDER BY se.created_at ASC`,
    )
    .all(id) as StateExecution[];

  return { ...run, state_executions };
}
