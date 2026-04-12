import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandExecutionRepository } from "./command-execution-repository";
import { WorkflowRunRepository } from "./workflow-run-repository";

describe("CommandExecutionRepository", () => {
  let db: Database.Database;
  let workflowRunRepository: WorkflowRunRepository;
  let commandExecutionRepository: CommandExecutionRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    workflowRunRepository = new WorkflowRunRepository(db);
    commandExecutionRepository = new CommandExecutionRepository(db);

    workflowRunRepository.ensureTables();
    commandExecutionRepository.ensureTables();

    // Seed a workflow run and step execution for FK references
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "lint",
      inputs_json: null,
      now: "2026-04-12T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "lint",
      stepType: "command",
      now: "2026-04-12T00:00:00.000Z",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("inserts a command execution and retrieves it by id", () => {
    commandExecutionRepository.insertCommandExecution({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      now: "2026-04-12T00:00:01.000Z",
    });

    const result = commandExecutionRepository.getCommandExecution("cmd-1");

    expect(result).toEqual({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      status: "running",
      exit_code: null,
      output_file_path: null,
      created_at: "2026-04-12T00:00:01.000Z",
      completed_at: null,
    });
  });

  it("returns undefined for non-existent id", () => {
    expect(
      commandExecutionRepository.getCommandExecution("nonexistent"),
    ).toBeUndefined();
  });

  it("retrieves a command execution by step_execution_id", () => {
    commandExecutionRepository.insertCommandExecution({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      now: "2026-04-12T00:00:01.000Z",
    });

    const result =
      commandExecutionRepository.getCommandExecutionByStepExecutionId("exec-1");

    expect(result).toEqual(
      expect.objectContaining({ id: "cmd-1", step_execution_id: "exec-1" }),
    );
  });

  it("returns undefined for non-existent step_execution_id", () => {
    expect(
      commandExecutionRepository.getCommandExecutionByStepExecutionId(
        "nonexistent",
      ),
    ).toBeUndefined();
  });

  it("completes a command execution with success", () => {
    commandExecutionRepository.insertCommandExecution({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      now: "2026-04-12T00:00:01.000Z",
    });

    commandExecutionRepository.completeCommandExecution({
      id: "cmd-1",
      status: "success",
      exit_code: 0,
      output_file_path: "/tmp/output.log",
      now: "2026-04-12T00:00:02.000Z",
    });

    const result = commandExecutionRepository.getCommandExecution("cmd-1");

    expect(result).toEqual({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      status: "success",
      exit_code: 0,
      output_file_path: "/tmp/output.log",
      created_at: "2026-04-12T00:00:01.000Z",
      completed_at: "2026-04-12T00:00:02.000Z",
    });
  });

  it("completes a command execution with failure", () => {
    commandExecutionRepository.insertCommandExecution({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      now: "2026-04-12T00:00:01.000Z",
    });

    commandExecutionRepository.completeCommandExecution({
      id: "cmd-1",
      status: "failure",
      exit_code: 1,
      output_file_path: "/tmp/output.log",
      now: "2026-04-12T00:00:02.000Z",
    });

    const result = commandExecutionRepository.getCommandExecution("cmd-1");

    expect(result?.status).toBe("failure");
    expect(result?.exit_code).toBe(1);
  });

  it("fails orphaned running command executions during recovery", () => {
    commandExecutionRepository.insertCommandExecution({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      now: "2026-04-12T00:00:01.000Z",
    });

    commandExecutionRepository.failRunningCommandExecutions(
      "2026-04-12T00:00:05.000Z",
    );

    const result = commandExecutionRepository.getCommandExecution("cmd-1");

    expect(result?.status).toBe("failure");
    expect(result?.completed_at).toBe("2026-04-12T00:00:05.000Z");
  });

  it("does not overwrite already-completed command executions during recovery", () => {
    commandExecutionRepository.insertCommandExecution({
      id: "cmd-1",
      step_execution_id: "exec-1",
      command: "npm run lint",
      cwd: "/tmp/repo/worktree",
      now: "2026-04-12T00:00:01.000Z",
    });
    commandExecutionRepository.completeCommandExecution({
      id: "cmd-1",
      status: "success",
      exit_code: 0,
      output_file_path: "/tmp/output.log",
      now: "2026-04-12T00:00:02.000Z",
    });

    commandExecutionRepository.failRunningCommandExecutions(
      "2026-04-12T00:00:05.000Z",
    );

    const result = commandExecutionRepository.getCommandExecution("cmd-1");

    expect(result?.status).toBe("success");
    expect(result?.completed_at).toBe("2026-04-12T00:00:02.000Z");
  });
});
