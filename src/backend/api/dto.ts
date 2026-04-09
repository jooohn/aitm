import type { Session } from "@/backend/domain/sessions";
import type {
  StepExecution,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "@/backend/domain/workflow-runs";
import type { WorkflowDefinition } from "@/backend/infra/config";
import { inferAlias } from "@/lib/utils/inferAlias";
import type {
  SessionDto,
  StepExecutionDto,
  WorkflowDefinitionDto,
  WorkflowRunDetailDto,
  WorkflowRunDto,
} from "@/shared/contracts/api";

function splitAlias(repositoryPath: string): {
  organization: string;
  name: string;
} {
  const alias = inferAlias(repositoryPath);
  const [organization, name] = alias.split("/");
  return { organization, name };
}

export function toSessionDto(session: Session): SessionDto {
  const { repository_path, ...rest } = session;
  return { ...rest, ...splitAlias(repository_path) };
}

export function toWorkflowDefinitionDto(
  workflow: WorkflowDefinition,
): WorkflowDefinitionDto {
  return { ...workflow };
}

export function toWorkflowRunDto(run: WorkflowRun): WorkflowRunDto {
  const { step_count_offset: _stepCountOffset, repository_path, ...rest } = run;
  return { ...rest, ...splitAlias(repository_path) };
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
