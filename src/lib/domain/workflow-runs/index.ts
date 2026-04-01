import { execFileSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import {
  getConfigWorkflows,
  resolveAgentConfig,
  type WorkflowTransition,
} from "../../infra/config";
import { type TransitionDecision } from "../../utils/agent";
import type { SessionService, SessionStatus } from "../sessions";
import type { WorktreeService } from "../worktrees";
import type {
  PreviousExecutionHandoff,
  WorkflowRunRepository,
} from "./workflow-run-repository";

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
  session_id: string | null;
  session_status: SessionStatus | null;
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

function isAlreadyTerminalSessionError(
  err: unknown,
  sessionId: string,
): boolean {
  return (
    err instanceof Error &&
    err.message.startsWith(
      `Session ${sessionId} is already in a terminal state:`,
    )
  );
}

export class WorkflowRunService {
  constructor(
    private workflowRunRepository: WorkflowRunRepository,
    private sessionService: SessionService,
    private worktreeService: WorktreeService,
  ) {}

  private startStateExecution(
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

    const stateDef = workflow.states?.[stateName];
    if (!stateDef) throw new Error(`State not found: ${stateName}`);

    const executionId = randomUUID();
    const now = new Date().toISOString();

    if ("command" in stateDef) {
      this.workflowRunRepository.insertStateExecution({
        id: executionId,
        workflowRunId,
        stateName,
        now,
      });

      let worktreePath: string | undefined;
      try {
        worktreePath = this.worktreeService
          .listWorktrees(repositoryPath)
          .find((w) => w.branch === worktreeBranch)?.path;
      } catch {
        // Worktree lookup failed — will be treated as no-path below.
      }

      if (!worktreePath) {
        this.completeStateExecution(executionId, null);
        return this.workflowRunRepository.getStateExecution(
          executionId,
        ) as StateExecution;
      }

      const result = spawnSync("sh", ["-c", stateDef.command], {
        cwd: worktreePath,
        encoding: "utf8",
      });
      const commandOutput =
        [result.stdout, result.stderr].filter(Boolean).join("\n") || null;
      const outcome = result.status === 0 ? "succeeded" : "failed";

      this.workflowRunRepository.setStateExecutionCommandOutput(
        executionId,
        commandOutput,
      );

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

      this.completeStateExecution(executionId, decision);
      return this.workflowRunRepository.getStateExecution(
        executionId,
      ) as StateExecution;
    }

    // Goal state path.
    const goal = buildGoal(stateDef.goal, previousExecutions, inputs);
    const agentConfig = resolveAgentConfig(stateDef.agent);

    this.workflowRunRepository.insertStateExecution({
      id: executionId,
      workflowRunId,
      stateName,
      now,
    });

    this.sessionService.createSession(
      {
        repository_path: repositoryPath,
        worktree_branch: worktreeBranch,
        goal,
        transitions: stateDef.transitions as WorkflowTransition[],
        agent_config: agentConfig,
        state_execution_id: executionId,
      },
      (decision) => {
        this.completeStateExecution(executionId, decision);
      },
    );

    return this.workflowRunRepository.getStateExecution(
      executionId,
    ) as StateExecution;
  }

  createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
    const workflows = getConfigWorkflows();
    const workflow = workflows[input.workflow_name];
    if (!workflow)
      throw new Error(`Workflow not found: ${input.workflow_name}`);

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
    const inputs_json = input.inputs ? JSON.stringify(input.inputs) : null;

    this.workflowRunRepository.insertWorkflowRun({
      id,
      repository_path: input.repository_path,
      worktree_branch: input.worktree_branch,
      workflow_name: input.workflow_name,
      initial_state: workflow.initial_state,
      inputs_json,
      now,
    });

    this.startStateExecution(
      id,
      workflow.initial_state,
      input.repository_path,
      input.worktree_branch,
      input.workflow_name,
      [],
      input.inputs,
    );

    return this.workflowRunRepository.getWorkflowRunById(id) as WorkflowRun;
  }

  completeStateExecution(
    stateExecutionId: string,
    decision: TransitionDecision | null,
  ): void {
    const execution =
      this.workflowRunRepository.getStateExecution(stateExecutionId);
    if (!execution) return;

    const run = this.workflowRunRepository.getWorkflowRunById(
      execution.workflow_run_id,
    );
    if (!run || run.status !== "running") return;

    const now = new Date().toISOString();

    this.workflowRunRepository.completeStateExecution(
      stateExecutionId,
      decision ? JSON.stringify(decision) : null,
      decision?.handoff_summary ?? null,
      now,
    );

    if (!decision) {
      // No structured output → mark as failure.
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    const { transition } = decision;

    if (transition === "success" || transition === "failure") {
      this.workflowRunRepository.terminateWorkflowRun(run.id, transition, now);
      return;
    }

    // Look up the workflow definition to validate the next state exists.
    const workflows = getConfigWorkflows();
    const workflow = workflows[run.workflow_name];
    if (!workflow || !workflow.states?.[transition]) {
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    // Advance to next state.
    this.workflowRunRepository.updateWorkflowRunCurrentState(
      run.id,
      transition,
      now,
    );

    // Collect all completed executions (including the current one, now committed) for handoff.
    const previousExecutions = this.workflowRunRepository
      .listCompletedExecutionsHandoff(run.id)
      .filter((e): e is PreviousExecutionHandoff => e.handoff_summary !== null);

    this.startStateExecution(
      run.id,
      transition,
      run.repository_path,
      run.worktree_branch,
      run.workflow_name,
      previousExecutions,
    );
  }

  stopWorkflowRun(id: string): WorkflowRunWithExecutions {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");
    if (run.status !== "running") {
      throw new Error("Workflow run is already in a terminal state");
    }

    const activeExecution =
      this.workflowRunRepository.getActiveStateExecution(id);

    if (!activeExecution?.session_id) {
      throw new Error("No active session to stop for this workflow run");
    }

    if (
      activeExecution.session_status === "RUNNING" ||
      activeExecution.session_status === "WAITING_FOR_INPUT"
    ) {
      try {
        this.sessionService.failSession(activeExecution.session_id);
      } catch (err) {
        if (!isAlreadyTerminalSessionError(err, activeExecution.session_id)) {
          throw err;
        }
      }
    }

    this.completeStateExecution(activeExecution.id, {
      transition: "failure",
      reason: "Emergency stop requested",
      handoff_summary: "Workflow run stopped manually.",
    });

    return this.getWorkflowRun(id)!;
  }

  // Mark state_executions as completed where the session has reached a terminal
  // state but the execution was never closed (e.g., due to a server crash).
  // Then fail any workflow runs that have no remaining active state execution.
  recoverCrashedWorkflowRuns(): void {
    const now = new Date().toISOString();

    // For uncompleted state executions whose session SUCCEEDED: replay completeStateExecution()
    // so the workflow advances (or terminates) correctly using the session's decision.
    // This handles the case where the server crashed after the session completed but before
    // the onComplete callback was invoked.
    const pendingSucceeded =
      this.workflowRunRepository.listPendingSucceededExecutions();

    for (const { execution_id, transition_decision } of pendingSucceeded) {
      let decision: TransitionDecision | null = null;
      if (transition_decision) {
        try {
          decision = JSON.parse(transition_decision) as TransitionDecision;
        } catch {
          // malformed JSON — treat as no decision, will terminate as failure
        }
      }
      this.completeStateExecution(execution_id, decision);
    }

    // For uncompleted state executions whose session FAILED while the workflow is still running:
    // close the failed execution and retry the same state with a new session.
    const pendingFailed =
      this.workflowRunRepository.listPendingFailedExecutions();

    for (const { execution_id, state, workflow_run_id } of pendingFailed) {
      this.workflowRunRepository.closeStateExecution(execution_id, now);

      const run = this.workflowRunRepository.getWorkflowRunById(
        workflow_run_id,
      ) as WorkflowRun;

      const previousExecutions = this.workflowRunRepository
        .listCompletedExecutionsHandoff(workflow_run_id)
        .filter(
          (e): e is PreviousExecutionHandoff => e.handoff_summary !== null,
        );

      const inputs = run.inputs
        ? (JSON.parse(run.inputs) as Record<string, string>)
        : undefined;

      this.startStateExecution(
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
    const orphanedCommandExecutions =
      this.workflowRunRepository.listOrphanedCommandExecutions();

    for (const { execution_id, workflow_run_id } of orphanedCommandExecutions) {
      this.workflowRunRepository.closeStateExecution(execution_id, now);
      this.workflowRunRepository.terminateWorkflowRun(
        workflow_run_id,
        "failure",
        now,
      );
    }

    // Close any remaining uncompleted state executions (workflow already terminated).
    this.workflowRunRepository.closeRemainingFailedExecutions(now);

    // Fail any workflow runs that still have no active state execution.
    this.workflowRunRepository.failRemainingRunningWorkflowRuns(now);
  }

  listWorkflowRuns(filter: ListWorkflowRunsFilter): WorkflowRun[] {
    return this.workflowRunRepository.listWorkflowRuns(filter);
  }

  rerunWorkflowRun(id: string): WorkflowRun {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "failure") {
      throw new Error("Only failed workflow runs can be re-run");
    }

    const worktrees = this.worktreeService.listWorktrees(run.repository_path);
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

    return this.createWorkflowRun({
      repository_path: run.repository_path,
      worktree_branch: run.worktree_branch,
      workflow_name: run.workflow_name,
      inputs,
    });
  }

  rerunWorkflowRunFromFailedState(id: string): WorkflowRunWithExecutions {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "failure") {
      throw new Error(
        "Only failed workflow runs can be re-run from failed state",
      );
    }

    const lastExecution = this.workflowRunRepository.getLastStateExecution(id);
    if (!lastExecution) throw new Error("Workflow run not found");

    const failedState = lastExecution.state;
    const now = new Date().toISOString();

    this.workflowRunRepository.setWorkflowRunRunning(id, failedState, now);

    const previousExecutions = this.workflowRunRepository
      .listCompletedExecutionsHandoffExcluding(id, lastExecution.id)
      .filter((e): e is PreviousExecutionHandoff => e.handoff_summary !== null);

    const inputs = run.inputs
      ? (JSON.parse(run.inputs) as Record<string, string>)
      : undefined;

    this.startStateExecution(
      id,
      failedState,
      run.repository_path,
      run.worktree_branch,
      run.workflow_name,
      previousExecutions,
      inputs,
    );

    return this.getWorkflowRun(id)!;
  }

  getWorkflowRun(id: string): WorkflowRunWithExecutions | undefined {
    return this.workflowRunRepository.getWorkflowRunWithExecutions(id);
  }
}
