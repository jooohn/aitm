import { randomUUID } from "crypto";
import {
  type AgentConfig,
  type AgentWorkflowStep,
  type CommandWorkflowStep,
  resolveAgentConfig,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@/backend/infra/config";
import type { TransitionDecision } from "../agent";
import type { CreateSessionInput, SessionService } from "../sessions";
import type { Worktree, WorktreeService } from "../worktrees";
import type { CommandStepExecutor } from "./command-step-executor";
import type { StepExecution } from "./index";
import type {
  PreviousExecutionHandoff,
  WorkflowRunRepository,
} from "./workflow-run-repository";

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

type StepCompletionHandler = (
  stepExecutionId: string,
  decision: TransitionDecision | null,
) => Promise<void>;

type SessionCreator = Pick<SessionService, "createSession">;
type WorktreeFinder = Pick<WorktreeService, "findWorktree">;
type CommandExecutor = Pick<CommandStepExecutor, "execute">;

export interface StartStepExecutionInput {
  workflowRunId: string;
  stepName: string;
  repositoryPath: string;
  worktreeBranch: string;
  workflowName: string;
  previousExecutions: PreviousExecutionHandoff[];
  inputs?: Record<string, string>;
}

export class StepRunner {
  private completeStepExecution: StepCompletionHandler = async () => {
    throw new Error("Step completion handler has not been configured");
  };

  constructor(
    private workflowRunRepository: WorkflowRunRepository,
    private sessionService: SessionCreator,
    private worktreeService: WorktreeFinder,
    private commandStepExecutor: CommandExecutor,
    private workflows: Record<string, WorkflowDefinition>,
    private agentConfig: AgentConfig,
  ) {}

  setStepCompletionHandler(handler: StepCompletionHandler): void {
    this.completeStepExecution = handler;
  }

  async startStepExecution(
    input: StartStepExecutionInput,
  ): Promise<StepExecution> {
    const workflows = this.workflows;
    const workflow = workflows[input.workflowName];
    if (!workflow) throw new Error(`Workflow not found: ${input.workflowName}`);

    const stepDef = workflow.steps?.[input.stepName];
    if (!stepDef) throw new Error(`Step not found: ${input.stepName}`);

    const executionId = randomUUID();
    const now = new Date().toISOString();

    this.workflowRunRepository.insertStepExecution({
      id: executionId,
      workflowRunId: input.workflowRunId,
      stepName: input.stepName,
      stepType: stepDef.type,
      now,
    });

    const worktree = await this.worktreeService.findWorktree(
      input.repositoryPath,
      input.worktreeBranch,
    );
    if (!worktree) {
      await this.completeStepExecution(executionId, null);
      return this.workflowRunRepository.getStepExecution(executionId)!;
    }

    await this.executeStep({
      executionId,
      repositoryPath: input.repositoryPath,
      workflowRunId: input.workflowRunId,
      worktree,
      stepDef,
      inputs: input.inputs,
      previousExecutions: input.previousExecutions,
    });

    return this.workflowRunRepository.getStepExecution(executionId)!;
  }

  private async executeStep(params: {
    stepDef: WorkflowStep;
    executionId: string;
    workflowRunId: string;
    repositoryPath: string;
    worktree: Worktree;
    inputs?: Record<string, string>;
    previousExecutions: PreviousExecutionHandoff[];
  }): Promise<void> {
    const { stepDef, worktree, ...remaining } = params;

    switch (stepDef.type) {
      case "command":
        await this.startCommandStepExecution({
          stepDef,
          worktree,
          ...remaining,
        });
        return;
      case "agent":
        await this.startAgentStepExecution({
          stepDef,
          worktree,
          ...remaining,
        });
        return;
      case "manual-approval":
        this.startManualApprovalStepExecution(params.executionId);
        return;
    }
  }

  private startManualApprovalStepExecution(executionId: string): void {
    this.workflowRunRepository.setStepExecutionStatus(executionId, "awaiting");
  }

  private async startCommandStepExecution({
    executionId,
    stepDef,
    worktree,
  }: {
    stepDef: CommandWorkflowStep;
    executionId: string;
    workflowRunId: string;
    worktree: Worktree;
  }): Promise<void> {
    const { outcome, commandOutput } = await this.commandStepExecutor.execute(
      stepDef.command,
      { cwd: worktree.path },
    );

    this.workflowRunRepository.setStepExecutionCommandOutput(
      executionId,
      commandOutput,
    );

    const matchedTransition = stepDef.transitions.find(
      (transition) => transition.when === outcome,
    );

    const decision = !matchedTransition
      ? null
      : {
          transition:
            "step" in matchedTransition
              ? matchedTransition.step
              : matchedTransition.terminal,
          reason: `Command ${outcome}`,
          handoff_summary: commandOutput ?? "",
        };

    await this.completeStepExecution(executionId, decision);
  }

  private async startAgentStepExecution({
    executionId,
    stepDef,
    repositoryPath,
    worktree,
    inputs,
    previousExecutions,
  }: {
    stepDef: AgentWorkflowStep;
    executionId: string;
    repositoryPath: string;
    workflowRunId: string;
    worktree: Worktree;
    inputs?: Record<string, string>;
    previousExecutions: PreviousExecutionHandoff[];
  }): Promise<void> {
    const goal = buildGoal(stepDef.goal, previousExecutions, inputs);
    const agentConfig = resolveAgentConfig(this.agentConfig, stepDef.agent);
    await this.sessionService.createSession({
      repository_path: repositoryPath,
      worktree_branch: worktree.branch,
      goal,
      transitions: stepDef.transitions,
      agent_config: agentConfig,
      step_execution_id: executionId,
      metadata_fields: stepDef.output?.metadata,
    } satisfies CreateSessionInput);
  }
}
