import type {
  ListWorkflowRunsFilter,
  WorkflowRun,
  WorkflowRunWithExecutions,
} from "./index";
import type { WorkflowRunRepository } from "./workflow-run-repository";

export class WorkflowRunQueries {
  constructor(private workflowRunRepository: WorkflowRunRepository) {}

  listWorkflowRuns(filter: ListWorkflowRunsFilter): WorkflowRun[] {
    return this.workflowRunRepository.listWorkflowRuns(filter);
  }

  getWorkflowRun(id: string): WorkflowRunWithExecutions | undefined {
    return this.workflowRunRepository.getWorkflowRunWithExecutions(id);
  }
}
