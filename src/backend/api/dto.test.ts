import { describe, expect, it } from "vitest";
import { toSessionDto } from "./dto";

describe("toSessionDto", () => {
  it("preserves clarifying_question in transition decisions", () => {
    const sessionDto = toSessionDto({
      id: "session-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      goal: "Goal",
      transitions: [],
      transition_decision: {
        transition: "__REQUIRE_USER_INPUT__",
        reason: "Need clarification",
        handoff_summary: "Waiting for user input",
        clarifying_question: "Which branch should I use?",
      },
      agent_config: { provider: "codex" },
      status: "awaiting_input",
      terminal_attach_command: null,
      log_file_path: "/tmp/session.log",
      claude_session_id: null,
      step_execution_id: null,
      metadata_fields: null,
      step_name: null,
      workflow_name: null,
      workflow_run_id: null,
      created_at: "2026-04-07T00:00:00.000Z",
      updated_at: "2026-04-07T00:00:00.000Z",
    });

    expect(sessionDto.transition_decision).toEqual({
      transition: "__REQUIRE_USER_INPUT__",
      reason: "Need clarification",
      handoff_summary: "Waiting for user input",
      clarifying_question: "Which branch should I use?",
    });
  });
});
