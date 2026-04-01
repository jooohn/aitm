import { HouseKeepingService } from "@/lib/domain/house-keeping";
import { PendingQuestionService } from "@/lib/domain/pending-questions";
import { RepositoryService } from "@/lib/domain/repositories";
import { SessionService } from "@/lib/domain/sessions";
import { SessionRepository } from "@/lib/domain/sessions/session-repository";
import { WorkflowRunService } from "@/lib/domain/workflow-runs";
import { WorkflowRunRepository } from "@/lib/domain/workflow-runs/workflow-run-repository";
import { WorktreeService } from "@/lib/domain/worktrees";
import { db } from "@/lib/infra/db";

export const workflowRunRepository = new WorkflowRunRepository(db);
export const sessionRepository = new SessionRepository(db);
export const worktreeService = new WorktreeService();
export const repositoryService = new RepositoryService();
export const pendingQuestionService = new PendingQuestionService();
export const sessionService = new SessionService(sessionRepository);
export const workflowRunService = new WorkflowRunService(
  workflowRunRepository,
  sessionService,
  worktreeService,
);
export const houseKeepingService = new HouseKeepingService(
  sessionService,
  worktreeService,
);
workflowRunRepository.ensureTables();
sessionRepository.ensureTables();
