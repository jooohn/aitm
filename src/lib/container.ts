import { SessionRepository } from "@/lib/domain/sessions/session-repository";
import { WorkflowRunRepository } from "@/lib/domain/workflow-runs/workflow-run-repository";
import { db } from "@/lib/infra/db";

export const workflowRunRepository = new WorkflowRunRepository(db);
export const sessionRepository = new SessionRepository(db);
workflowRunRepository.ensureTables();
sessionRepository.ensureTables();
