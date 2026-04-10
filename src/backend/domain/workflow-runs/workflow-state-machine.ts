import type { WorkflowDefinition } from "@/backend/infra/config";
import type { SessionStatusChangedEvent } from "@/backend/infra/event-bus";
import type { TransitionDecision } from "../agent";
import type {
  StepExecutionStatus,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "./index";
import type { StartStepExecutionInput, StepRunner } from "./step-runner";
import type {
  PreviousExecutionHandoff,
  WorkflowRunRepository,
} from "./workflow-run-repository";

const DEFAULT_MAX_STEP_EXECUTIONS = 30;

export class WorkflowStateMachine {
  constructor(
    private workflowRunRepository: WorkflowRunRepository,
    private stepRunner: Pick<StepRunner, "startStepExecution">,
    private workflows: Record<string, WorkflowDefinition>,
  ) {}

  async handleSessionStatusChanged(
    event: SessionStatusChangedEvent,
  ): Promise<void> {
    const activeExecution =
      this.workflowRunRepository.findActiveExecutionBySessionId(
        event.sessionId,
      );
    if (!activeExecution) return;

    const run = this.workflowRunRepository.getWorkflowRunById(
      activeExecution.workflow_run_id,
    );
    const now = new Date().toISOString();

    switch (event.status) {
      case "awaiting_input":
        this.workflowRunRepository.setStepExecutionStatus(
          activeExecution.id,
          "awaiting",
        );
        if (run?.status === "running") {
          this.workflowRunRepository.setWorkflowRunAwaiting(run.id, now);
        }
        return;
      case "running":
        this.workflowRunRepository.setStepExecutionStatus(
          activeExecution.id,
          "running",
        );
        if (run?.status === "awaiting" && run.current_step) {
          this.workflowRunRepository.setWorkflowRunRunning(
            run.id,
            run.current_step,
            now,
          );
        }
        return;
      case "success":
        await this.completeStepExecution(activeExecution.id, event.decision);
        return;
      case "failure":
        await this.completeStepExecution(activeExecution.id, null);
        return;
    }
  }

  handleStepExecutionStatusChanged(
    workflowRunId: string,
    status: StepExecutionStatus,
  ): void {
    const run = this.workflowRunRepository.getWorkflowRunById(workflowRunId);
    if (!run) return;

    const now = new Date().toISOString();
    if (status === "awaiting" && run.status === "running") {
      this.workflowRunRepository.setWorkflowRunAwaiting(workflowRunId, now);
      return;
    }

    if (status === "running" && run.status === "awaiting" && run.current_step) {
      this.workflowRunRepository.setWorkflowRunRunning(
        workflowRunId,
        run.current_step,
        now,
      );
    }
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
    if (!run || (run.status !== "running" && run.status !== "awaiting")) return;

    const now = new Date().toISOString();
    const stepStatus: StepExecutionStatus =
      !decision || decision.transition === "failure" ? "failure" : "success";

    this.workflowRunRepository.completeStepExecution(
      stepExecutionId,
      decision ? JSON.stringify(decision) : null,
      decision?.handoff_summary ?? null,
      now,
      stepStatus,
    );

    if (decision?.metadata && Object.keys(decision.metadata).length > 0) {
      this.workflowRunRepository.mergeWorkflowRunMetadata(
        run.id,
        decision.metadata,
      );
    }

    if (!decision) {
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    if (!decision.transition) {
      // No transition means the agent needs user input — set run to awaiting
      this.workflowRunRepository.setWorkflowRunAwaiting(run.id, now);
      return;
    }

    if (
      decision.transition === "success" ||
      decision.transition === "failure"
    ) {
      this.workflowRunRepository.terminateWorkflowRun(
        run.id,
        decision.transition,
        now,
      );
      return;
    }

    const workflows = this.workflows;
    const workflow = workflows[run.workflow_name];
    if (!workflow || !workflow.steps?.[decision.transition]) {
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    const maxSteps = workflow.max_steps ?? DEFAULT_MAX_STEP_EXECUTIONS;
    const stepCount =
      this.workflowRunRepository.countStepExecutions(run.id) -
      (run.step_count_offset ?? 0);
    if (stepCount >= maxSteps) {
      this.workflowRunRepository.terminateWorkflowRun(run.id, "failure", now);
      return;
    }

    if (run.status === "awaiting") {
      this.workflowRunRepository.setWorkflowRunRunning(
        run.id,
        decision.transition,
        now,
      );
    } else {
      this.workflowRunRepository.updateWorkflowRunCurrentStep(
        run.id,
        decision.transition,
        now,
      );
    }

    const nextExecution = await this.stepRunner.startStepExecution({
      workflowRunId: run.id,
      stepName: decision.transition,
      repositoryPath: run.repository_path,
      worktreeBranch: run.worktree_branch,
      workflowName: run.workflow_name,
      previousExecutions: this.workflowRunRepository
        .listCompletedExecutionsHandoff(run.id)
        .filter(
          (execution): execution is PreviousExecutionHandoff =>
            execution.handoff_summary !== null,
        ),
      inputs: run.inputs ?? undefined,
    } satisfies StartStepExecutionInput);

    if (nextExecution.status === "awaiting") {
      this.workflowRunRepository.setWorkflowRunAwaiting(run.id, now);
    }
  }

  async resolveManualApproval(
    id: string,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<WorkflowRunWithExecutions> {
    const now = new Date().toISOString();
    const run = this.workflowRunRepository.getWorkflowRunById(id);
    if (!run) throw new Error("Workflow run not found");
    if (run.status !== "running" && run.status !== "awaiting") {
      throw new Error("Workflow run is not running");
    }

    const activeExecution =
      this.workflowRunRepository.getActiveStepExecution(id);
    if (!activeExecution || activeExecution.step_type !== "manual-approval") {
      throw new Error("Active step execution is not a manual-approval step");
    }

    const workflows = this.workflows;
    const workflow = workflows[run.workflow_name];
    if (!workflow) throw new Error(`Workflow not found: ${run.workflow_name}`);

    const stepDef = workflow.steps?.[activeExecution.step];
    if (!stepDef) throw new Error(`Step not found: ${activeExecution.step}`);

    const matchedTransition = stepDef.transitions.find(
      (transition) => transition.when === decision,
    );

    await this.completeStepExecution(
      activeExecution.id,
      !matchedTransition
        ? null
        : {
            transition:
              "step" in matchedTransition
                ? matchedTransition.step
                : matchedTransition.terminal,
            reason: reason || `Manually ${decision}`,
            handoff_summary: reason || "",
          },
    );

    if (
      this.workflowRunRepository.getActiveStepExecution(id)?.status ===
      "awaiting"
    ) {
      this.workflowRunRepository.setWorkflowRunAwaiting(id, now);
    }

    return this.workflowRunRepository.getWorkflowRunWithExecutions(id)!;
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

    const now = new Date().toISOString();
    const failedStep = lastExecution.step;
    const stepCountOffset = this.workflowRunRepository.countStepExecutions(id);

    this.workflowRunRepository.setStepCountOffset(id, stepCountOffset);
    this.workflowRunRepository.setWorkflowRunRunning(id, failedStep, now);

    await this.stepRunner.startStepExecution({
      workflowRunId: id,
      stepName: failedStep,
      repositoryPath: run.repository_path,
      worktreeBranch: run.worktree_branch,
      workflowName: run.workflow_name,
      previousExecutions: this.workflowRunRepository
        .listCompletedExecutionsHandoffExcluding(id, lastExecution.id)
        .filter(
          (execution): execution is PreviousExecutionHandoff =>
            execution.handoff_summary !== null,
        ),
      inputs: run.inputs ?? undefined,
    });

    if (
      this.workflowRunRepository.getActiveStepExecution(id)?.status ===
      "awaiting"
    ) {
      this.workflowRunRepository.setWorkflowRunAwaiting(id, now);
    }

    return this.workflowRunRepository.getWorkflowRunWithExecutions(id)!;
  }

  async recoverCrashedWorkflowRuns(): Promise<void> {
    const now = new Date().toISOString();

    for (const pending of this.workflowRunRepository.listPendingSucceededExecutions()) {
      await this.completeStepExecution(
        pending.execution_id,
        pending.transition_decision,
      );
    }

    for (const pending of this.workflowRunRepository.listPendingFailedExecutions()) {
      this.workflowRunRepository.closeStepExecution(pending.execution_id, now);

      const run = this.workflowRunRepository.getWorkflowRunById(
        pending.workflow_run_id,
      );
      if (!run) continue;

      await this.stepRunner.startStepExecution({
        workflowRunId: pending.workflow_run_id,
        stepName: pending.step,
        repositoryPath: run.repository_path,
        worktreeBranch: run.worktree_branch,
        workflowName: run.workflow_name,
        previousExecutions: this.workflowRunRepository
          .listCompletedExecutionsHandoff(pending.workflow_run_id)
          .filter(
            (execution): execution is PreviousExecutionHandoff =>
              execution.handoff_summary !== null,
          ),
        inputs: run.inputs ?? undefined,
      });
    }

    for (const orphan of this.workflowRunRepository.listOrphanedCommandExecutions()) {
      this.workflowRunRepository.closeStepExecution(orphan.execution_id, now);
      this.workflowRunRepository.terminateWorkflowRun(
        orphan.workflow_run_id,
        "failure",
        now,
      );
    }

    this.workflowRunRepository.closeRemainingFailedExecutions(now);
    this.workflowRunRepository.failRemainingRunningWorkflowRuns(now);
  }
}
