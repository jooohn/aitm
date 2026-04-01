import { AgentService } from "@/backend/domain/agent";
import { HouseKeepingService } from "@/backend/domain/house-keeping";
import { RepositoryService } from "@/backend/domain/repositories";
import { SessionService } from "@/backend/domain/sessions";
import { SessionRepository } from "@/backend/domain/sessions/session-repository";
import { WorkflowRunService } from "@/backend/domain/workflow-runs";
import { WorkflowRunRepository } from "@/backend/domain/workflow-runs/workflow-run-repository";
import { WorktreeService } from "@/backend/domain/worktrees";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";

export const workflowRunRepository = new WorkflowRunRepository(db);
export const sessionRepository = new SessionRepository(db);
export const worktreeService = new WorktreeService();
export const repositoryService = new RepositoryService();
export const agentService = new AgentService();
export const sessionService = new SessionService(
  sessionRepository,
  agentService,
  worktreeService,
  eventBus,
);
export const workflowRunService = new WorkflowRunService(
  workflowRunRepository,
  sessionService,
  worktreeService,
  eventBus,
);
export const houseKeepingService = new HouseKeepingService(
  sessionService,
  worktreeService,
);
workflowRunRepository.ensureTables();
sessionRepository.ensureTables();
