import type { Session } from "@/backend/domain/sessions";
import type {
  StepExecution,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "@/backend/domain/workflow-runs";
import type { WorkflowDefinition } from "@/backend/infra/config";
import type {
  SessionDto,
  StepExecutionDto,
  WorkflowDefinitionDto,
  WorkflowRunDetailDto,
  WorkflowRunDto,
} from "@/shared/contracts/api";

export function toSessionDto(session: Session): SessionDto {
  return { ...session };
}

export function toWorkflowDefinitionDto(
  workflow: WorkflowDefinition,
): WorkflowDefinitionDto {
  return { ...workflow };
}

export function toWorkflowRunDto(run: WorkflowRun): WorkflowRunDto {
  const { step_count_offset: _stepCountOffset, ...dto } = run;
  return dto;
}

export function toStepExecutionDto(execution: StepExecution): StepExecutionDto {
  return { ...execution };
}

export function toWorkflowRunDetailDto(
  run: WorkflowRunWithExecutions,
): WorkflowRunDetailDto {
  return {
    ...toWorkflowRunDto(run),
    step_executions: run.step_executions.map(toStepExecutionDto),
  };
}
