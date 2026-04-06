import { randomUUID } from "crypto";
import {
  AgentWorkflowStep,
  CommandWorkflowStep,
  getConfigWorkflows,
  ManualApprovalWorkflowStep,
  resolveAgentConfig,
  type WorkflowDefinition,
  WorkflowStep,
} from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import { logger } from "@/backend/infra/logger";
import { spawnAsync } from "@/backend/utils/process";
import { type TransitionDecision } from "../agent";
import type { SessionService, SessionStatus } from "../sessions";
import type { Worktree, WorktreeService } from "../worktrees";
import type { CommandStepExecutor } from "./command-step-executor";
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
  current_step: string | null;
  status: WorkflowRunStatus;
  inputs: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepExecution {
  id: string;
  workflow_run_id: string;
  step: string;
  step_type: "agent" | "command" | "manual-approval";
  command_output: string | null;
  session_id: string | null;
  session_status: SessionStatus | null;
  transition_decision: string | null;
  handoff_summary: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkflowRunWithExecutions extends WorkflowRun {
  step_executions: StepExecution[];
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
  stepGoal: string,
  previousExecutions: PreviousExecutionHandoff[],
  inputs?: Record<string, string>,
): string {
  const parts = ["<goal>", stepGoal, "</goal>"];

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
    parts.push("", "<handoff>", "Previous steps (oldest first):", "");
    for (const prev of previousExecutions) {
      parts.push(`Step: ${prev.step}`, `Summary: ${prev.handoff_summary}`);
      if (prev.log_file_path) {
        parts.push(`Log: ${prev.log_file_path}`);
      }
      parts.push("");
    }
    parts.push("</handoff>");
  }

  return parts.join("\n");
}

const DEFAULT_MAX_STEP_EXECUTIONS = 30;

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
    private commandStepExecutor: CommandStepExecutor,
    private eventBus: EventBus,
  ) {
    eventBus.on("session.completed", ({ sessionId, decision }) => {
      this.handleSessionComplete(sessionId, decision);
    });
  }

  private async handleSessionComplete(
    sessionId: string,
    decision: TransitionDecision | null,
  ): Promise<void> {
    const session = this.sessionService.getSession(sessionId);
    if (!session?.step_execution_id) return;
    await this.completeStepExecution(session.step_execution_id, decision);
  }

  private async startStepExecution(
    workflowRunId: string,
    stepName: string,
    repositoryPath: string,
    worktreeBranch: string,
    workflowName: string,
    previousExecutions: PreviousExecutionHandoff[],
    inputs?: Record<string, string>,
  ): Promise<StepExecution> {
    const workflows = await getConfigWorkflows();
    const workflow = workflows[workflowName];
    if (!workflow) throw new Error(`Workflow not found: ${workflowName}`);

    const stepDef = workflow.steps?.[stepName];
    if (!stepDef) throw new Error(`Step not found: ${stepName}`);

    const executionId = randomUUID();
    const now = new Date().toISOString();

    this.workflowRunRepository.insertStepExecution({
      id: executionId,
      workflowRunId,
      stepName,
      stepType: stepDef.type,
      now,
    });

    const worktree = await this.worktreeService.findWorktree(
      repositoryPath,
      worktreeBranch,
    );
    if (!worktree && stepDef.type !== "manual-approval") {
      await this.completeStepExecution(executionId, null);
      return this.workflowRunRepository.getStepExecution(executionId)!;
    }
    await this.executeStep({
      stepDef,
      executionId,
      workflowRunId,
      repositoryPath,
      worktree: worktree ?? null,
      inputs,
      previousExecutions,
    });
    return this.workflowRunRepository.getStepExecution(executionId)!;
  }

  private executeStep(params: {
    stepDef: WorkflowStep;
    executionId: string;
    workflowRunId: string;
    repositoryPath: string;
    worktree: Worktree | null;
    inputs?: Record<string, string>;
    previousExecutions: PreviousExecutionHandoff[];
  }) {
    const { stepDef, worktree, ...remaining } = params;
    switch (stepDef.type) {
      case "command":
        return this.startCommandStepExecution({
          stepDef,
          worktree: worktree!,
          ...remaining,
        });
      case "agent":
        return this.startAgentStepExecution({
          stepDef,
          worktree: worktree!,
          ...remaining,
        });
      case "manual-approval":
        this.eventBus.emit("step-execution.awaiting-approval", {
          stepExecutionId: params.executionId,
          workflowRunId: params.workflowRunId,
        });
        return;
    }
  }

  private async startCommandStepExecution({
    stepDef,
    executionId,
    worktree,
  }: {
    stepDef: CommandWorkflowStep;
    executionId: string;
    worktree: Worktree;
  }) {
    const { outcome, commandOutput } = await this.commandStepExecutor.execute(
      stepDef.command,
      { cwd: worktree.path },
    );

    this.workflowRunRepository.setStepExecutionCommandOutput(
      executionId,
      commandOutput,
    );

    const matchedTransition = stepDef.transitions.find(
      (t) => t.when === outcome,
    );

    let decision: TransitionDecision | null;
    if (!matchedTransition) {
      decision = null;
    } else {
      const transitionName =
        "step" in matchedTransition
          ? matchedTransition.step
          : matchedTransition.terminal;
      decision = {
        transition: transitionName,
        reason: `Command ${outcome}`,
        handoff_summary: commandOutput ?? "",
      };
    }

    await this.completeStepExecution(executionId, decision);
  }

  private async startAgentStepExecution({
    stepDef,
    executionId,
    repositoryPath,
    worktree,
    inputs,
    previousExecutions,
  }: {
    stepDef: AgentWorkflowStep;
    executionId: string;
    repositoryPath: string;
    worktree: Worktree;
    inputs?: Record<string, string>;
    previousExecutions: PreviousExecutionHandoff[];
  }) {
    const goal = buildGoal(stepDef.goal, previousExecutions, inputs);
    const agentConfig = await resolveAgentConfig(stepDef.agent);
    await this.sessionService.createSession({
      repository_path: repositoryPath,
      worktree_branch: worktree.branch,
      goal,
      transitions: stepDef.transitions,
      agent_config: agentConfig,
      step_execution_id: executionId,
      metadata_fields: stepDef.output?.metadata,
    });
  }

  async createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
    const workflows = await getConfigWorkflows();
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
      initial_step: workflow.initial_step,
      inputs_json,
      now,
    });

    await this.startStepExecution(
      id,
      workflow.initial_step,
      input.repository_path,
      input.worktree_branch,
      input.workflow_name,
      [],
      input.inputs,
    );

    return this.workflowRunRepository.getWorkflowRunById(id) as WorkflowRun;
  }

  async completeStepExecution(
    stepExecutionId: string,
    decision: TransitionDecision | null,
  ): Promise<void> {
    const execution =
      this.workflowRunRepository.getStepExecution(stepExecutionId);
    if (!execution) return;

    const run = this.workflowRunRepository.getWorkflowRunById(
      execution.workflow_run_id,
    );
    if (!run || run.status !== "running") return;

    const now = new Date().toISOString();

    this.workflowRunRepository.completeStepExecution(
      stepExecutionId,
      decision ? JSON.stringify(decision) : null,
      decision?.handoff_summary ?? null,
      now,
    );

    if (decision?.metadata && Object.keys(decision.metadata).length > 0) {
      this.workflowRunRepository.mergeWorkflowRunMetadata(
        run.id,
        decision.metadata,
      );
    }

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
    const workflows = await getConfigWorkflows();
    const workflow = workflows[run.workflow_name];
    if (!workflow || !workflow.steps?.[transition]) {
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    // Guard: terminate if step executions exceed the maximum allowed.
    const maxSteps = workflow.max_steps ?? DEFAULT_MAX_STEP_EXECUTIONS;
    const stepCount = this.workflowRunRepository.countStepExecutions(run.id);
    if (stepCount >= maxSteps) {
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    // Advance to next state.
    this.workflowRunRepository.updateWorkflowRunCurrentStep(
      run.id,
      transition,
      now,
    );

    // Collect all completed executions (including the current one, now committed) for handoff.
    const previousExecutions = this.workflowRunRepository
      .listCompletedExecutionsHandoff(run.id)
      .filter((e): e is PreviousExecutionHandoff => e.handoff_summary !== null);

    await this.startStepExecution(
      run.id,
      transition,
      run.repository_path,
      run.worktree_branch,
      run.workflow_name,
      previousExecutions,
    );
  }

  async resolveManualApproval(
    id: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<WorkflowRunWithExecutions> {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");
    if (run.status !== "running") {
      throw new Error("Workflow run is not running");
    }

    const activeExecution =
      this.workflowRunRepository.getActiveStepExecution(id);
    if (!activeExecution || activeExecution.step_type !== "manual-approval") {
      throw new Error("Active step execution is not a manual-approval step");
    }

    const workflows = await getConfigWorkflows();
    const workflow = workflows[run.workflow_name];
    if (!workflow) throw new Error(`Workflow not found: ${run.workflow_name}`);

    const stepDef = workflow.steps?.[activeExecution.step];
    if (!stepDef) {
      throw new Error(`Step not found: ${activeExecution.step}`);
    }

    const matchedTransition = stepDef.transitions.find(
      (t) => t.when === decision,
    );

    let transitionDecision: TransitionDecision | null;
    if (!matchedTransition) {
      transitionDecision = null;
    } else {
      const transitionName =
        "step" in matchedTransition
          ? matchedTransition.step
          : matchedTransition.terminal;
      transitionDecision = {
        transition: transitionName,
        reason: reason || `Manually ${decision}`,
        handoff_summary: reason || "",
      };
    }

    await this.completeStepExecution(activeExecution.id, transitionDecision);

    return this.getWorkflowRun(id)!;
  }

  async stopWorkflowRun(id: string): Promise<WorkflowRunWithExecutions> {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");
    if (run.status !== "running") {
      throw new Error("Workflow run is already in a terminal state");
    }

    const activeExecution =
      this.workflowRunRepository.getActiveStepExecution(id);

    if (!activeExecution?.session_id) {
      throw new Error("No active session to stop for this workflow run");
    }

    if (activeExecution.session_status === "RUNNING") {
      try {
        this.sessionService.failSession(activeExecution.session_id);
      } catch (err) {
        if (!isAlreadyTerminalSessionError(err, activeExecution.session_id)) {
          throw err;
        }
      }
    }

    await this.completeStepExecution(activeExecution.id, {
      transition: "failure",
      reason: "Emergency stop requested",
      handoff_summary: "Workflow run stopped manually.",
    });

    return this.getWorkflowRun(id)!;
  }

  // Mark step_executions as completed where the session has reached a terminal
  // state but the execution was never closed (e.g., due to a server crash).
  // Then fail any workflow runs that have no remaining active state execution.
  async recoverCrashedWorkflowRuns(): Promise<void> {
    const now = new Date().toISOString();

    // For uncompleted state executions whose session SUCCEEDED: replay completeStepExecution()
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
      await this.completeStepExecution(execution_id, decision);
    }

    // For uncompleted state executions whose session FAILED while the workflow is still running:
    // close the failed execution and retry the same state with a new session.
    const pendingFailed =
      this.workflowRunRepository.listPendingFailedExecutions();

    for (const { execution_id, step, workflow_run_id } of pendingFailed) {
      this.workflowRunRepository.closeStepExecution(execution_id, now);

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

      await this.startStepExecution(
        workflow_run_id,
        step,
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
      this.workflowRunRepository.closeStepExecution(execution_id, now);
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

  listPendingApprovals() {
    return this.workflowRunRepository.listPendingApprovals();
  }

  async rerunWorkflowRun(id: string): Promise<WorkflowRun> {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "failure" && run.status !== "success") {
      throw new Error("Only completed workflow runs can be re-run");
    }

    const worktrees = await this.worktreeService.listWorktrees(
      run.repository_path,
    );
    const worktree = worktrees.find((w) => w.branch === run.worktree_branch);
    if (!worktree) {
      throw new Error(`Worktree not found for branch: ${run.worktree_branch}`);
    }

    try {
      await spawnAsync("git", ["stash", "--include-untracked"], {
        cwd: worktree.path,
      });
    } catch (err) {
      // Non-zero exit from git stash is non-blocking — log a warning and continue.
      logger.warn({ err }, "git stash warning");
    }

    const inputs = run.inputs
      ? (JSON.parse(run.inputs) as Record<string, string>)
      : undefined;

    return await this.createWorkflowRun({
      repository_path: run.repository_path,
      worktree_branch: run.worktree_branch,
      workflow_name: run.workflow_name,
      inputs,
    });
  }

  async rerunWorkflowRunFromFailedState(
    id: string,
  ): Promise<WorkflowRunWithExecutions> {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");

    if (run.status !== "failure") {
      throw new Error(
        "Only failed workflow runs can be re-run from failed state",
      );
    }

    const lastExecution = this.workflowRunRepository.getLastStepExecution(id);
    if (!lastExecution) throw new Error("Workflow run not found");

    const failedStep = lastExecution.step;
    const now = new Date().toISOString();

    this.workflowRunRepository.setWorkflowRunRunning(id, failedStep, now);

    const previousExecutions = this.workflowRunRepository
      .listCompletedExecutionsHandoffExcluding(id, lastExecution.id)
      .filter((e): e is PreviousExecutionHandoff => e.handoff_summary !== null);

    const inputs = run.inputs
      ? (JSON.parse(run.inputs) as Record<string, string>)
      : undefined;

    await this.startStepExecution(
      id,
      failedStep,
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
