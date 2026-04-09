import type { Chat, ChatProposal } from "@/backend/domain/chats";
import type { Session } from "@/backend/domain/sessions";
import type {
  StepExecution,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "@/backend/domain/workflow-runs";
import type { WorkflowDefinition } from "@/backend/infra/config";
import { splitAlias } from "@/lib/utils/inferAlias";
import type {
  ChatDetailDto,
  ChatDto,
  ChatProposalDto,
  SessionDto,
  StepExecutionDto,
  WorkflowDefinitionDto,
  WorkflowRunDetailDto,
  WorkflowRunDto,
} from "@/shared/contracts/api";

export function toChatDto(chat: Chat): ChatDto {
  const {
    repository_path,
    agent_config: _ac,
    log_file_path: _lf,
    claude_session_id: _cs,
    ...rest
  } = chat;
  return { ...rest, ...splitAlias(repository_path) };
}

export function toChatProposalDto(proposal: ChatProposal): ChatProposalDto {
  return { ...proposal };
}

export function toChatDetailDto(
  chat: Chat,
  proposals: ChatProposal[],
): ChatDetailDto {
  return {
    ...toChatDto(chat),
    proposals: proposals.map(toChatProposalDto),
  };
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
