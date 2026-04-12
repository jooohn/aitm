import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionRepository } from "../sessions/session-repository";
import { CommandExecutionRepository } from "./command-execution-repository";
import { WorkflowRunQueries } from "./workflow-run-queries";
import { WorkflowRunRepository } from "./workflow-run-repository";

describe("WorkflowRunQueries", () => {
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let workflowRunRepository: WorkflowRunRepository;
  let workflowRunQueries: WorkflowRunQueries;

  beforeEach(() => {
    db = new Database(":memory:");
    sessionRepository = new SessionRepository(db);
    workflowRunRepository = new WorkflowRunRepository(db);

    workflowRunRepository.ensureTables();
    new CommandExecutionRepository(db).ensureTables();
    sessionRepository.ensureTables();

    workflowRunQueries = new WorkflowRunQueries(workflowRunRepository);
  });

  it("lists workflow runs through the repository filter API", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-a",
      repository_path: "/tmp/repo-a",
      worktree_branch: "feat/a",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertWorkflowRun({
      id: "run-b",
      repository_path: "/tmp/repo-b",
      worktree_branch: "feat/b",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:01.000Z",
    });

    const runs = workflowRunQueries.listWorkflowRuns({
      repository_path: "/tmp/repo-b",
    });

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("run-b");
  });

  it("returns a run with step executions ordered by created_at", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-2",
      workflowRunId: "run-1",
      stepName: "implement",
      stepType: "agent",
      now: "2026-04-07T00:00:01.000Z",
    });

    const run = workflowRunQueries.getWorkflowRun("run-1");

    expect(run?.step_executions.map((execution) => execution.id)).toEqual([
      "exec-1",
      "exec-2",
    ]);
  });
});
