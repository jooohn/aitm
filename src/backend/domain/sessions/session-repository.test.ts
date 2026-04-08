import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunRepository } from "../workflow-runs/workflow-run-repository";
import { SessionRepository } from "./session-repository";

describe("SessionRepository.listPersistedWorktreeBranches", () => {
  let db: Database.Database;
  let workflowRunRepository: WorkflowRunRepository;
  let sessionRepository: SessionRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    workflowRunRepository = new WorkflowRunRepository(db);
    sessionRepository = new SessionRepository(db);

    workflowRunRepository.ensureTables();
    sessionRepository.ensureTables();
  });

  afterEach(() => {
    db.close();
  });

  it("returns distinct branches from both sessions and workflow runs for one repository", () => {
    sessionRepository.insertSession({
      id: "session-1",
      repository_path: "/tmp/repo-a",
      worktree_branch: "feat/session-only",
      goal: "Goal",
      transitions: [],
      agent_config: { provider: "codex" },
      log_file_path: "/tmp/session-1.log",
      step_execution_id: null,
      metadata_fields: null,
      now: "2026-04-08T00:00:00.000Z",
    });
    sessionRepository.insertSession({
      id: "session-2",
      repository_path: "/tmp/repo-a",
      worktree_branch: "feat/shared",
      goal: "Goal",
      transitions: [],
      agent_config: { provider: "codex" },
      log_file_path: "/tmp/session-2.log",
      step_execution_id: null,
      metadata_fields: null,
      now: "2026-04-08T00:00:00.000Z",
    });
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo-a",
      worktree_branch: "feat/shared",
      workflow_name: "test-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-08T00:00:00.000Z",
    });
    workflowRunRepository.insertWorkflowRun({
      id: "run-2",
      repository_path: "/tmp/repo-a",
      worktree_branch: "feat/run-only",
      workflow_name: "test-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-08T00:00:00.000Z",
    });
    workflowRunRepository.insertWorkflowRun({
      id: "run-3",
      repository_path: "/tmp/repo-b",
      worktree_branch: "feat/other-repo",
      workflow_name: "test-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-08T00:00:00.000Z",
    });

    expect(
      sessionRepository.listPersistedWorktreeBranches("/tmp/repo-a"),
    ).toEqual(["feat/run-only", "feat/session-only", "feat/shared"]);
  });
});
