import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowTransition } from "@/backend/infra/config";
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
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: "run-1",
        status: "running",
      }),
    );
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
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        stepExecutionId: "exec-1",
        workflowRunId: "run-1",
        status: "awaiting",
      }),
    );
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
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: "run-1",
        status: "awaiting",
      }),
    );
  });

  it("emits session.status-changed for each recovered crashed session", () => {
    sessionRepository.insertSession({
      id: "session-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      goal: "Goal",
      transitions: [],
      agent_config: { provider: "codex" },
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
      transitions: [],
      agent_config: { provider: "codex" },
      log_file_path: "/tmp/session-2.log",
      step_execution_id: null,
      metadata_fields: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const listener = vi.fn();
    eventBus.on("session.status-changed", listener);

    sessionRepository.recoverCrashedSessions();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        status: "failure",
        decision: null,
      }),
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-2",
        status: "failure",
        decision: null,
      }),
    );
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
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: "run-1",
        status: "failure",
      }),
    );
  });

  it("deserializes workflow run and session JSON-backed fields when reading", () => {
    const transitions: WorkflowTransition[] = [
      { step: "implement", when: "plan is ready" },
    ];

    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: JSON.stringify({ ticket: "42" }),
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.completeStepExecution(
      "exec-1",
      JSON.stringify({
        transition: "implement",
        reason: "Ready",
        handoff_summary: "Plan complete",
        clarifying_question: "Which deployment target should I use?",
      }),
      "Plan complete",
      "2026-04-07T00:00:01.000Z",
      "success",
    );
    workflowRunRepository.mergeWorkflowRunMetadata("run-1", {
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });

    sessionRepository.insertSession({
      id: "session-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      goal: "Goal",
      transitions,
      agent_config: { provider: "codex", model: "gpt-5.4" },
      log_file_path: "/tmp/session-1.log",
      step_execution_id: "exec-1",
      metadata_fields: {
        pr_url: {
          type: "string",
          description: "Pull request URL",
        },
      },
      now: "2026-04-07T00:00:00.000Z",
    });

    const run = workflowRunRepository.getWorkflowRunWithExecutions("run-1");
    const session = sessionRepository.getSession("session-1");

    expect(run?.inputs).toEqual({ ticket: "42" });
    expect(run?.metadata).toEqual({
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });
    expect(run?.step_executions[0].transition_decision).toEqual({
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan complete",
      clarifying_question: "Which deployment target should I use?",
    });
    expect(session?.transitions).toEqual(transitions);
    expect(session?.agent_config).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });
    expect(session?.metadata_fields).toEqual({
      pr_url: {
        type: "string",
        description: "Pull request URL",
      },
    });
  });

  it("filters malformed workflow run string records when reading", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    db.prepare(
      `UPDATE workflow_runs
       SET inputs = ?, metadata = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify({
        ticket: "42",
        attempt: 3,
        nested: { title: "bad" },
      }),
      JSON.stringify({
        presets__pull_request_url: "https://github.com/org/repo/pull/42",
        nested: { title: "bad" },
        enabled: true,
      }),
      "run-1",
    );

    const run = workflowRunRepository.getWorkflowRunById("run-1");

    expect(run?.inputs).toEqual({ ticket: "42" });
    expect(run?.metadata).toEqual({
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });
  });

  it("ignores invalid clarifying_question values when reading transition decisions", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-2",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-2",
      workflowRunId: "run-2",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });

    workflowRunRepository.completeStepExecution(
      "exec-2",
      JSON.stringify({
        reason: "Need clarification",
        handoff_summary: "Waiting",
        clarifying_question: 42,
      }),
      "Waiting",
      "2026-04-07T00:00:01.000Z",
      "awaiting",
    );

    const run = workflowRunRepository.getWorkflowRunWithExecutions("run-2");

    expect(run?.step_executions[0].transition_decision).toEqual({
      reason: "Need clarification",
      handoff_summary: "Waiting",
    });
  });

  it("adds output_file_path to legacy step_executions tables", () => {
    db.exec("DROP TABLE step_executions");
    db.exec(`
      CREATE TABLE step_executions (
        id                  TEXT    PRIMARY KEY,
        workflow_run_id     TEXT    NOT NULL REFERENCES workflow_runs(id),
        step                TEXT    NOT NULL,
        step_type           TEXT    NOT NULL DEFAULT 'agent',
        command_output      TEXT,
        transition_decision TEXT,
        handoff_summary     TEXT,
        created_at          TEXT    NOT NULL,
        completed_at        TEXT
      );
    `);

    workflowRunRepository.ensureTables();

    const columns = db
      .prepare("PRAGMA table_info(step_executions)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain("output_file_path");
  });

  it("does not create command_output on fresh step_executions tables", () => {
    const columns = db
      .prepare("PRAGMA table_info(step_executions)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).not.toContain(
      "command_output",
    );
  });

  it("returns output_file_path when reading workflow executions and handoffs", () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-3",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "lint",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-3",
      workflowRunId: "run-3",
      stepName: "lint",
      stepType: "command",
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.setStepExecutionOutputFilePath(
      "exec-3",
      "/tmp/run-3/command-outputs/exec-3.log",
    );
    workflowRunRepository.completeStepExecution(
      "exec-3",
      JSON.stringify({
        transition: "success",
        reason: "Command succeeded",
        handoff_summary:
          "Command succeeded. Detailed output: /tmp/run-3/command-outputs/exec-3.log",
      }),
      "Command succeeded. Detailed output: /tmp/run-3/command-outputs/exec-3.log",
      "2026-04-07T00:00:01.000Z",
      "success",
    );

    const run = workflowRunRepository.getWorkflowRunWithExecutions("run-3");
    const handoff =
      workflowRunRepository.listCompletedExecutionsHandoff("run-3");

    expect(run?.step_executions[0].output_file_path).toBe(
      "/tmp/run-3/command-outputs/exec-3.log",
    );
    expect(handoff).toEqual([
      {
        step: "lint",
        handoff_summary:
          "Command succeeded. Detailed output: /tmp/run-3/command-outputs/exec-3.log",
        log_file_path: null,
        output_file_path: "/tmp/run-3/command-outputs/exec-3.log",
      },
    ]);
  });
});
