import { describe, expect, it } from "vitest";
import { parseLogEntry } from "./parseLogEntry";

describe("parseLogEntry", () => {
  it("formats system/init", () => {
    expect(parseLogEntry({ type: "system", subtype: "init" })).toEqual({
      kind: "text",
      content: "▶ Session started",
    });
  });

  it("formats result/success", () => {
    expect(parseLogEntry({ type: "result", subtype: "success" })).toEqual({
      kind: "text",
      content: "✓ Goal completed",
    });
  });

  it("formats result with other subtype", () => {
    expect(
      parseLogEntry({ type: "result", subtype: "error_max_turns" }),
    ).toEqual({
      kind: "text",
      content: "✗ Session ended: error_max_turns",
    });
  });

  it("formats error", () => {
    expect(parseLogEntry({ type: "error", message: "Oops" })).toEqual({
      kind: "text",
      content: "! Error: Oops",
    });
  });

  it("formats accepted user input", () => {
    expect(
      parseLogEntry({ type: "user_input", message: "Use PostgreSQL" }),
    ).toEqual({
      kind: "text",
      content: "You: Use PostgreSQL",
    });
  });

  it("formats generic event with message", () => {
    expect(
      parseLogEntry({
        type: "event",
        event_type: "error",
        message: "Reconnecting... 2/5",
      }),
    ).toEqual({
      kind: "text",
      content: "• error: Reconnecting... 2/5",
    });
  });

  it("formats generic event without message", () => {
    expect(
      parseLogEntry({
        type: "event",
        event_type: "turn.started",
      }),
    ).toEqual({
      kind: "text",
      content: "• turn.started",
    });
  });

  it("formats command_execution event as a structured item", () => {
    expect(
      parseLogEntry({
        type: "event",
        event_type: "command_execution",
        detail: {
          command: "/bin/zsh -lc 'git status --short'",
          aggregated_output: " M src/app/page.tsx\n",
          exit_code: 0,
          status: "completed",
        },
      }),
    ).toEqual({
      kind: "command_execution",
      command: "/bin/zsh -lc 'git status --short'",
      output: " M src/app/page.tsx\n",
      exitCode: 0,
      status: "completed",
    });
  });

  it("formats assistant with single text block", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello there" }],
      },
    };
    expect(parseLogEntry(entry)).toEqual({
      kind: "text",
      content: "Hello there",
    });
  });

  it("formats assistant with multiple text blocks", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello there" },
          { type: "text", text: "How can I help?" },
        ],
      },
    };
    expect(parseLogEntry(entry)).toEqual([
      { kind: "text", content: "Hello there" },
      { kind: "text", content: "How can I help?" },
    ]);
  });

  it("formats assistant tool_use block without input", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash" }],
      },
    };
    expect(parseLogEntry(entry)).toEqual({
      kind: "tool_call",
      toolName: "Bash",
    });
  });

  it("formats assistant tool_use block with input", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    };
    expect(parseLogEntry(entry)).toEqual({
      kind: "tool_call",
      toolName: "Bash",
      input: { command: "ls -la" },
    });
  });

  it("formats assistant with mixed content", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Running command" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    };
    expect(parseLogEntry(entry)).toEqual([
      { kind: "text", content: "Running command" },
      { kind: "tool_call", toolName: "Bash", input: { command: "ls" } },
    ]);
  });

  it("returns null for assistant with no displayable content", () => {
    const entry = {
      type: "assistant",
      message: { content: [{ type: "tool_result" }] },
    };
    expect(parseLogEntry(entry)).toBeNull();
  });

  it("returns null for assistant with empty content array", () => {
    const entry = { type: "assistant", message: { content: [] } };
    expect(parseLogEntry(entry)).toBeNull();
  });

  it("returns null for user type (SDK-internal)", () => {
    expect(parseLogEntry({ type: "user" })).toBeNull();
  });

  it("returns null for unknown types", () => {
    expect(parseLogEntry({ type: "something_else" })).toBeNull();
  });
});
