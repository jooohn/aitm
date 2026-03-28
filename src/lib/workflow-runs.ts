import { randomUUID } from "crypto";
import { startWorkflowStateAgent, type TransitionDecision } from "./agent";
import { getConfigWorkflows } from "./config";
import { db } from "./db";
import { insertSession } from "./sessions";

export type WorkflowRunStatus = "running" | "success" | "failure";

export interface WorkflowRun {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_state: string | null;
  status: WorkflowRunStatus;
  created_at: string;
  updated_at: string;
}

export interface StateExecution {
  id: string;
  workflow_run_id: string;
  state: string;
  session_id: string;
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
}

export interface ListWorkflowRunsFilter {
  repository_path?: string;
  worktree_branch?: string;
  status?: WorkflowRunStatus;
}

type PreviousExecutionHandoff = {
  state: string;
  handoff_summary: string;
  log_file_path: string;
};

function buildStatePrompt(
  goal: string,
  transitions: Array<{ state?: string; terminal?: string; when: string }>,
  previousExecutions: PreviousExecutionHandoff[],
): string {
  const transitionList = transitions
    .map((t) => {
      const target =
        "state" in t && t.state
          ? t.state
          : `terminal:${(t as { terminal: string }).terminal}`;
      return `  - "${target}": ${t.when}`;
    })
    .join("\n");

  const parts = [
    "<goal>",
    goal,
    "</goal>",
    "",
    "<transitions>",
    "When you finish your work, evaluate which transition applies and emit it as your final structured output.",
    "Available transitions (emit the exact transition name in the 'transition' field):",
    transitionList,
    "</transitions>",
  ];

  if (previousExecutions.length > 0) {
    parts.push("", "<handoff>", "Previous states (oldest first):", "");
    for (const prev of previousExecutions) {
      parts.push(
        `State: ${prev.state}`,
        `Summary: ${prev.handoff_summary}`,
        `Log: ${prev.log_file_path}`,
        "",
      );
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
): StateExecution {
  const workflows = getConfigWorkflows();
  const workflow = workflows[workflowName];
  if (!workflow) throw new Error(`Workflow not found: ${workflowName}`);

  const stateDef = workflow.states[stateName];
  if (!stateDef) throw new Error(`State not found: ${stateName}`);

  const prompt = buildStatePrompt(
    stateDef.goal,
    stateDef.transitions as Array<{
      state?: string;
      terminal?: string;
      when: string;
    }>,
    previousExecutions,
  );

  const session = insertSession({
    repository_path: repositoryPath,
    worktree_branch: worktreeBranch,
    goal: prompt,
    completion_condition:
      "Emit a structured transition decision as final output.",
  });

  const now = new Date().toISOString();
  const executionId = randomUUID();

  db.prepare(
    `INSERT INTO state_executions
       (id, workflow_run_id, state, session_id, transition_decision, handoff_summary, created_at, completed_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)`,
  ).run(executionId, workflowRunId, stateName, session.id, now);

  // Wire up the agent to advance the workflow when it completes.
  startWorkflowStateAgent(
    session.id,
    repositoryPath,
    worktreeBranch,
    prompt,
    session.log_file_path,
    (decision) => {
      completeStateExecution(executionId, decision);
    },
  ).catch(console.error);

  return db
    .prepare("SELECT * FROM state_executions WHERE id = ?")
    .get(executionId) as StateExecution;
}

export function createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
  const workflows = getConfigWorkflows();
  const workflow = workflows[input.workflow_name];
  if (!workflow) throw new Error(`Workflow not found: ${input.workflow_name}`);

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO workflow_runs
       (id, repository_path, worktree_branch, workflow_name, current_state, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
  ).run(
    id,
    input.repository_path,
    input.worktree_branch,
    input.workflow_name,
    workflow.initial_state,
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
         JOIN sessions s ON se.session_id = s.id
         WHERE se.workflow_run_id = ? AND se.completed_at IS NOT NULL
         ORDER BY se.created_at ASC`,
      )
      .all(run.id) as Array<{
      state: string;
      handoff_summary: string | null;
      log_file_path: string;
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

export function getWorkflowRun(
  id: string,
): WorkflowRunWithExecutions | undefined {
  const run = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
    | WorkflowRun
    | undefined;
  if (!run) return undefined;

  const state_executions = db
    .prepare(
      "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
    )
    .all(id) as StateExecution[];

  return { ...run, state_executions };
}
