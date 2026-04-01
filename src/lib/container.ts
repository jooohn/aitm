import { SessionService } from "@/lib/domain/sessions";
import { SessionRepository } from "@/lib/domain/sessions/session-repository";
import { WorkflowRunService } from "@/lib/domain/workflow-runs";
import { WorkflowRunRepository } from "@/lib/domain/workflow-runs/workflow-run-repository";
import { db } from "@/lib/infra/db";

export const workflowRunRepository = new WorkflowRunRepository(db);
export const sessionRepository = new SessionRepository(db);
export const sessionService = new SessionService(sessionRepository);
export const workflowRunService = new WorkflowRunService(
  workflowRunRepository,
  sessionService,
);
workflowRunRepository.ensureTables();
sessionRepository.ensureTables();
