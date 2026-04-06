import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/backend/infra/event-bus";
import { SessionRepository } from "../sessions/session-repository";
import { WorkflowRunRepository } from "./workflow-run-repository";

describe("WorkflowRunRepository event emission", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let sessionRepository: SessionRepository;
  let workflowRunRepository: WorkflowRunRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    eventBus = new EventBus();
    sessionRepository = new SessionRepository(db, eventBus);
    workflowRunRepository = new WorkflowRunRepository(db, eventBus);

    workflowRunRepository.ensureTables();
    sessionRepository.ensureTables();
  });

  afterEach(() => {
    db.close();
  });

  it("emits workflow-run.status-changed when inserting a workflow run", () => {
    const listener = vi.fn();
    eventBus.on("workflow-run.status-changed", listener);

    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      workflowRunId: "run-1",
      status: "running",
    });
  });

  it("emits step-execution.status-changed only when the persisted status changes", () => {
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

    const listener = vi.fn();
    eventBus.on("step-execution.status-changed", listener);

    workflowRunRepository.setStepExecutionStatus("exec-1", "running");
    expect(listener).not.toHaveBeenCalled();

    workflowRunRepository.setStepExecutionStatus("exec-1", "awaiting");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      stepExecutionId: "exec-1",
      workflowRunId: "run-1",
      status: "awaiting",
    });
  });

  it("emits workflow-run.status-changed only when the persisted status changes", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const listener = vi.fn();
    eventBus.on("workflow-run.status-changed", listener);

    workflowRunRepository.setWorkflowRunRunning(
      "run-1",
      "plan",
      "2026-04-07T00:00:01.000Z",
    );
    expect(listener).not.toHaveBeenCalled();

    workflowRunRepository.setWorkflowRunAwaiting(
      "run-1",
      "2026-04-07T00:00:02.000Z",
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      workflowRunId: "run-1",
      status: "awaiting",
    });
  });

  it("emits session.status-changed for each recovered crashed session", () => {
    sessionRepository.insertSession({
      id: "session-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      goal: "Goal",
      transitions: "[]",
      agent_config: '{"provider":"codex"}',
      log_file_path: "/tmp/session-1.log",
      step_execution_id: null,
      metadata_fields: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    sessionRepository.insertSession({
      id: "session-2",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      goal: "Goal",
      transitions: "[]",
      agent_config: '{"provider":"codex"}',
      log_file_path: "/tmp/session-2.log",
      step_execution_id: null,
      metadata_fields: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const listener = vi.fn();
    eventBus.on("session.status-changed", listener);

    sessionRepository.recoverCrashedSessions();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      status: "FAILED",
      decision: null,
    });
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-2",
      status: "FAILED",
      decision: null,
    });
  });

  it("emits workflow-run.status-changed when recovery fails stranded running workflow runs", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const listener = vi.fn();
    eventBus.on("workflow-run.status-changed", listener);

    workflowRunRepository.failRemainingRunningWorkflowRuns(
      "2026-04-07T00:00:01.000Z",
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      workflowRunId: "run-1",
      status: "failure",
    });
  });
});
