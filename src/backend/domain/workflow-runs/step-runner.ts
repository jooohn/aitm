import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import {
  type AgentConfig,
  type AgentWorkflowStep,
  type CommandWorkflowStep,
  resolveAgentConfig,
  type WorkflowArtifact,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@/backend/infra/config";
import type { TransitionDecision } from "../agent";
import type { CreateSessionInput, SessionService } from "../sessions";
import {
  resolveWorkflowRunDir,
  type Worktree,
  type WorktreeService,
} from "../worktrees";
import type { CommandStepExecutor } from "./command-step-executor";
import type { StepExecution } from "./index";
import type {
  PreviousExecutionHandoff,
  WorkflowRunRepository,
} from "./workflow-run-repository";

function buildGoal(
  stepGoal: string,
  previousExecutions: PreviousExecutionHandoff[],
  artifacts: Array<{ name: string; path: string; description?: string }>,
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

  if (artifacts.length > 0) {
    parts.push("", "<artifacts>");
    for (const artifact of artifacts) {
      parts.push(`Artifact: ${artifact.name}`, `Path: ${artifact.path}`);
      if (artifact.description) {
        parts.push(`Description: ${artifact.description}`);
      }
      parts.push("");
    }
    parts.push("</artifacts>");
  }

  if (previousExecutions.length > 0) {
    parts.push("", "<handoff>", "Previous steps (oldest first):", "");
    for (const prev of previousExecutions) {
      parts.push(`Step: ${prev.step}`, `Summary: ${prev.handoff_summary}`);
      if (prev.log_file_path) {
        parts.push(`Log: ${prev.log_file_path}`);
      }
      if (prev.output_file_path) {
        parts.push(`Output: ${prev.output_file_path}`);
      }
      parts.push("");
    }
    parts.push("</handoff>");
  }

  return parts.join("\n");
}

function resolveWorkflowArtifacts(
  workflowRunId: string,
  worktreePath: string,
  artifacts?: WorkflowArtifact[],
): Array<{ name: string; path: string; description?: string }> {
  if (!artifacts || artifacts.length === 0) return [];

  const artifactRoot = join(
    worktreePath,
    ".aitm",
    "runs",
    workflowRunId,
    "artifacts",
  );
  return artifacts.map((artifact) => ({
    name: artifact.name,
    path: join(artifactRoot, artifact.path),
    description: artifact.description,
  }));
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
      workflowArtifacts: workflow.artifacts,
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
    workflowArtifacts?: WorkflowArtifact[];
    inputs?: Record<string, string>;
    previousExecutions: PreviousExecutionHandoff[];
  }): Promise<void> {
    const { stepDef, worktree, ...remaining } = params;
    const artifacts = resolveWorkflowArtifacts(
      params.workflowRunId,
      worktree.path,
      params.workflowArtifacts,
    );

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
          artifacts,
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
    workflowRunId,
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

    const outputFilePath = await this.persistCommandOutput(
      executionId,
      workflowRunId,
      worktree,
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
          handoff_summary: `Command ${outcome}. Detailed output: ${outputFilePath}`,
        };

    await this.completeStepExecution(executionId, decision);
  }

  private async persistCommandOutput(
    executionId: string,
    workflowRunId: string,
    worktree: Worktree,
    commandOutput: string | null,
  ): Promise<string> {
    const outputDir = join(
      resolveWorkflowRunDir(worktree, workflowRunId),
      "command-output",
    );
    const outputFilePath = join(outputDir, `${executionId}.log`);

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputFilePath, commandOutput ?? "", "utf8");

    this.workflowRunRepository.setStepExecutionOutputFilePath(
      executionId,
      outputFilePath,
    );

    return outputFilePath;
  }

  private async startAgentStepExecution({
    executionId,
    stepDef,
    artifacts,
    repositoryPath,
    workflowRunId,
    worktree,
    inputs,
    previousExecutions,
  }: {
    stepDef: AgentWorkflowStep;
    executionId: string;
    artifacts: Array<{ name: string; path: string; description?: string }>;
    repositoryPath: string;
    workflowRunId: string;
    worktree: Worktree;
    inputs?: Record<string, string>;
    previousExecutions: PreviousExecutionHandoff[];
  }): Promise<void> {
    const goal = buildGoal(stepDef.goal, previousExecutions, artifacts, inputs);
    const agentConfig = resolveAgentConfig(this.agentConfig, stepDef.agent);
    const logFilePath = join(
      resolveWorkflowRunDir(worktree, workflowRunId),
      "logs",
      `${executionId}.log`,
    );
    await this.sessionService.createSession({
      repository_path: repositoryPath,
      worktree_branch: worktree.branch,
      goal,
      transitions: stepDef.transitions,
      log_file_path: logFilePath,
      agent_config: agentConfig,
      step_execution_id: executionId,
      metadata_fields: stepDef.output?.metadata,
    } satisfies CreateSessionInput);
  }
}
