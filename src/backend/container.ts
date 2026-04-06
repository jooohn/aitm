import { AgentService } from "@/backend/domain/agent";
import { ClaudeSDK } from "@/backend/domain/agent/claude-sdk";
import { CodexSDK } from "@/backend/domain/agent/codex-sdk";
import { HouseKeepingService } from "@/backend/domain/house-keeping";
import { RepositoryService } from "@/backend/domain/repositories";
import { SessionService } from "@/backend/domain/sessions";
import { SessionRepository } from "@/backend/domain/sessions/session-repository";
import { WorkflowRunService } from "@/backend/domain/workflow-runs";
import { CommandStepExecutor } from "@/backend/domain/workflow-runs/command-step-executor";
import { WorkflowRunRepository } from "@/backend/domain/workflow-runs/workflow-run-repository";
import { WorktreeService } from "@/backend/domain/worktrees";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";

export const workflowRunRepository = new WorkflowRunRepository(db, eventBus);
export const sessionRepository = new SessionRepository(db);
export const worktreeService = new WorktreeService();
export const repositoryService = new RepositoryService();
export const agentService = new AgentService({
  claude: new ClaudeSDK(),
  codex: new CodexSDK(),
});
export const sessionService = new SessionService(
  sessionRepository,
  agentService,
  worktreeService,
  eventBus,
);
export const commandStepExecutor = new CommandStepExecutor();
export const workflowRunService = new WorkflowRunService(
  workflowRunRepository,
  sessionService,
  worktreeService,
  commandStepExecutor,
  eventBus,
);
export const houseKeepingService = new HouseKeepingService(
  sessionService,
  worktreeService,
);
workflowRunRepository.ensureTables();
sessionRepository.ensureTables();
