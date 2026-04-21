import { randomUUID } from "crypto";
import type {
  AgentConfig,
  AgentsMap,
  WorkflowDefinition,
} from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import { logger } from "@/backend/infra/logger";
import { spawnAsync } from "@/backend/utils/process";
import type { TransitionDecision } from "../agent";
import { NotFoundError, ValidationError } from "../errors";
import type { SessionService, SessionStatus } from "../sessions";
import { Worktree, WorktreeService } from "../worktrees";
import type { CommandExecutionRepository } from "./command-execution-repository";
import type { CommandStepExecutor } from "./command-step-executor";
import * as gitExcludeManager from "./git-exclude-manager";
import { StepRunner } from "./step-runner";
import { WorkflowRunMaterializer } from "./workflow-run-materializer";
import { WorkflowRunQueries } from "./workflow-run-queries";
import type { WorkflowRunRepository } from "./workflow-run-repository";
import { WorkflowStateMachine } from "./workflow-state-machine";

export type WorkflowRunStatus = "running" | "awaiting" | "success" | "failure";
export type StepExecutionStatus =
  | "running"
  | "awaiting"
  | "success"
  | "failure";

export interface WorkflowRun {
  id: string;
  repository_path: string;
  worktree_branch: string;
  workflow_name: string;
  current_step: string | null;
  status: WorkflowRunStatus;
  inputs: Record<string, string> | null;
  metadata: Record<string, string> | null;
  step_count_offset: number;
  created_at: string;
  updated_at: string;
}

export interface StepExecution {
  id: string;
  workflow_run_id: string;
  step: string;
  step_type: "agent" | "command" | "manual-approval";
  status: StepExecutionStatus;
  output_file_path: string | null;
  session_id: string | null;
  session_status: SessionStatus | null;
  command_execution_id: string | null;
  transition_decision: TransitionDecision | null;
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

function isAlreadyTerminalSessionError(
  error: ValidationError,
  sessionId: string,
): boolean {
  return error.message.startsWith(
    `Session ${sessionId} is already in a terminal state:`,
  );
}

export class WorkflowRunService {
  private workflowRunQueries: WorkflowRunQueries;
  private stepRunner: StepRunner;
  private workflowStateMachine: WorkflowStateMachine;
  private materializer: WorkflowRunMaterializer;

  constructor(
    private workflowRunRepository: WorkflowRunRepository,
    private commandExecutionRepository: CommandExecutionRepository,
    private sessionService: SessionService,
    private worktreeService: WorktreeService,
    private commandStepExecutor: CommandStepExecutor,
    private eventBus: EventBus,
    private workflows: Record<string, WorkflowDefinition>,
    private agents: AgentsMap,
    private defaultAgent: string,
  ) {
    this.workflowRunQueries = new WorkflowRunQueries(workflowRunRepository);
    this.materializer = new WorkflowRunMaterializer(
      workflowRunRepository,
      worktreeService,
      gitExcludeManager,
    );
    this.stepRunner = new StepRunner(
      workflowRunRepository,
      commandExecutionRepository,
      sessionService,
      worktreeService,
      commandStepExecutor,
      workflows,
      agents,
      defaultAgent,
    );
    this.workflowStateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      commandExecutionRepository,
      this.stepRunner,
      workflows,
    );
    this.stepRunner.setStepCompletionHandler(
      this.workflowStateMachine.completeStepExecution.bind(
        this.workflowStateMachine,
      ),
    );

    eventBus.on("session.status-changed", (event) => {
      void this.workflowStateMachine
        .handleSessionStatusChanged(event)
        .catch((err) =>
          logger.error(
            { err, sessionId: event.sessionId, status: event.status },
            "Failed to handle session status change",
          ),
        );
    });
    eventBus.on(
      "step-execution.status-changed",
      ({ workflowRunId, status }) => {
        this.workflowStateMachine.handleStepExecutionStatusChanged(
          workflowRunId,
          status,
        );
      },
    );
  }

  async createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
    const workflows = this.workflows;
    const workflow = workflows[input.workflow_name];
    if (!workflow) throw new NotFoundError("Workflow", input.workflow_name);

    // Validate required inputs.
    if (workflow.inputs) {
      for (const inputDef of workflow.inputs) {
        const required = inputDef.required !== false; // default true
        if (required) {
          const value = input.inputs?.[inputDef.name];
          if (!value || value.trim() === "") {
            throw new ValidationError(
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

    const worktree = await this.worktreeService.findWorktree(
      input.repository_path,
      input.worktree_branch,
    );
    if (worktree) {
      await this.materializer.ensureWorkflowRunDir(id, worktree);
      if (workflow.artifacts && workflow.artifacts.length > 0) {
        await this.materializer.materializeWorkflowArtifacts(
          id,
          workflow.artifacts,
          worktree,
        );
      }
    }

    const initialExecution = await this.stepRunner.startStepExecution({
      workflowRunId: id,
      stepName: workflow.initial_step,
      repositoryPath: input.repository_path,
      worktreeBranch: input.worktree_branch,
      workflowName: input.workflow_name,
      previousExecutions: [],
      inputs: input.inputs,
    });

    if (initialExecution.status === "awaiting") {
      this.workflowRunRepository.setWorkflowRunAwaiting(id, now);
    }

    return this.workflowRunRepository.getWorkflowRunById(id) as WorkflowRun;
  }

  async completeStepExecution(
    stepExecutionId: string,
    decision: TransitionDecision | null,
  ): Promise<void> {
    await this.workflowStateMachine.completeStepExecution(
      stepExecutionId,
      decision,
    );
  }

  async resolveManualApproval(
    id: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<WorkflowRunWithExecutions> {
    return this.workflowStateMachine.resolveManualApproval(
      id,
      decision,
      reason,
    );
  }

  async stopWorkflowRun(id: string): Promise<WorkflowRunWithExecutions> {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new NotFoundError("Workflow run");
    if (run.status !== "running" && run.status !== "awaiting") {
      throw new ValidationError("Workflow run is already in a terminal state");
    }

    const activeExecution =
      this.workflowRunRepository.getActiveStepExecution(id);

    if (!activeExecution?.session_id) {
      throw new ValidationError(
        "No active session to stop for this workflow run",
      );
    }

    if (activeExecution.session_status === "running") {
      const result = this.sessionService.failSession(
        activeExecution.session_id,
      );
      if (
        !result.ok &&
        !(
          result.error instanceof ValidationError &&
          isAlreadyTerminalSessionError(
            result.error,
            activeExecution.session_id,
          )
        )
      ) {
        throw result.error;
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
    await this.workflowStateMachine.recoverCrashedWorkflowRuns();
  }

  listWorkflowRuns(filter: ListWorkflowRunsFilter): WorkflowRun[] {
    return this.workflowRunQueries.listWorkflowRuns(filter);
  }

  async rerunWorkflowRun(id: string): Promise<WorkflowRun> {
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new NotFoundError("Workflow run");

    if (run.status !== "failure" && run.status !== "success") {
      throw new ValidationError("Only completed workflow runs can be re-run");
    }

    const workflow = this.workflows[run.workflow_name];
    const isMainBranch = workflow?.runs_on === "main";

    const worktrees = await this.worktreeService.listWorktrees(
      run.repository_path,
    );
    const worktree = worktrees.find((w) => w.branch === run.worktree_branch);
    if (!worktree) {
      throw new NotFoundError("Worktree", run.worktree_branch);
    }

    if (!isMainBranch) {
      try {
        await spawnAsync("git", ["stash", "--include-untracked"], {
          cwd: worktree.path,
        });
      } catch (err) {
        // Non-zero exit from git stash is non-blocking — log a warning and continue.
        logger.warn({ err }, "git stash warning");
      }
    }

    return await this.createWorkflowRun({
      repository_path: run.repository_path,
      worktree_branch: run.worktree_branch,
      workflow_name: run.workflow_name,
      inputs: run.inputs ?? undefined,
    });
  }

  async rerunWorkflowRunFromFailedState(
    id: string,
  ): Promise<WorkflowRunWithExecutions> {
    await this.materializer.ensureLegacyCommandOutputFiles(id);
    return this.workflowStateMachine.rerunWorkflowRunFromFailedState(id);
  }

  getWorkflowRun(id: string): WorkflowRunWithExecutions | undefined {
    return this.workflowRunQueries.getWorkflowRun(id);
  }

  async getWorkflowRunForDisplay(
    id: string,
  ): Promise<WorkflowRunWithExecutions | undefined> {
    await this.materializer.ensureLegacyCommandOutputFiles(id);
    return this.getWorkflowRun(id);
  }
}
