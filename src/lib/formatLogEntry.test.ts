import { describe, expect, it } from "vitest";
import { formatLogEntry } from "./formatLogEntry";

describe("formatLogEntry", () => {
  it("formats system/init", () => {
    expect(formatLogEntry({ type: "system", subtype: "init" })).toBe(
      "▶ Session started",
    );
  });

  it("formats result/success", () => {
    expect(formatLogEntry({ type: "result", subtype: "success" })).toBe(
      "✓ Goal completed",
    );
  });

  it("formats result with other subtype", () => {
    expect(formatLogEntry({ type: "result", subtype: "error_max_turns" })).toBe(
      "✗ Session ended: error_max_turns",
    );
  });

  it("formats question", () => {
    expect(
      formatLogEntry({ type: "question", question: "Which branch?" }),
    ).toBe("? Which branch?");
  });

  it("formats answer", () => {
    expect(formatLogEntry({ type: "answer", answer: "main" })).toBe("> main");
  });

  it("formats error", () => {
    expect(formatLogEntry({ type: "error", message: "Oops" })).toBe(
      "! Error: Oops",
    );
  });

  it("formats assistant text blocks", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello there" },
          { type: "text", text: "How can I help?" },
        ],
      },
    };
    expect(formatLogEntry(entry)).toBe("Hello there\nHow can I help?");
  });

  it("formats assistant tool_use blocks", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash" }],
      },
    };
    expect(formatLogEntry(entry)).toBe("[Bash]");
  });

  it("formats assistant with mixed content", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Running command" },
          { type: "tool_use", name: "Bash" },
        ],
      },
    };
    expect(formatLogEntry(entry)).toBe("Running command\n[Bash]");
  });

  it("returns null for assistant with no displayable content", () => {
    const entry = {
      type: "assistant",
      message: { content: [{ type: "tool_result" }] },
    };
    expect(formatLogEntry(entry)).toBeNull();
  });

  it("returns null for assistant with empty content array", () => {
    const entry = { type: "assistant", message: { content: [] } };
    expect(formatLogEntry(entry)).toBeNull();
  });

  it("returns null for user type (SDK-internal)", () => {
    expect(formatLogEntry({ type: "user" })).toBeNull();
  });

  it("returns null for unknown types", () => {
    expect(formatLogEntry({ type: "something_else" })).toBeNull();
  });
});
