import type { ThreadEvent } from "@openai/codex-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, AgentQueryParams } from "./runtime";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const runStreamedMock = vi.fn();
const startThreadMock = vi.fn(() => ({ runStreamed: runStreamedMock }));

vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn(() => ({ startThread: startThreadMock })),
}));

// Import after mocks are set up
const { codexSDK } = await import("./codex-sdk");

function makeQueryParams(
  overrides?: Partial<AgentQueryParams>,
): AgentQueryParams {
  return {
    sessionId: "sess-1",
    prompt: "do something",
    cwd: "/tmp/repo",
    permissionMode: "acceptEdits",
    abortController: new AbortController(),
    ...overrides,
  };
}

async function collectMessages(
  iter: AsyncIterable<AgentMessage>,
): Promise<AgentMessage[]> {
  const msgs: AgentMessage[] = [];
  for await (const m of iter) msgs.push(m);
  return msgs;
}

async function* eventsFromArray(
  events: ThreadEvent[],
): AsyncGenerator<ThreadEvent> {
  for (const e of events) yield e;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("codexSDK.query", () => {
  it("maps thread.started to system/init with session_id", async () => {
    const events: ThreadEvent[] = [
      { type: "thread.started", thread_id: "thread-abc" },
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const msgs = await collectMessages(codexSDK.query(makeQueryParams()));

    expect(msgs[0]).toEqual({
      type: "system",
      subtype: "init",
      session_id: "thread-abc",
    });
  });

  it("maps item.completed with agent_message to assistant message", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "Hello world" },
      },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const msgs = await collectMessages(codexSDK.query(makeQueryParams()));

    expect(msgs).toContainEqual({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
  });

  it("maps item.completed with command_execution to event message", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "ls",
          aggregated_output: "file.txt",
          exit_code: 0,
          status: "completed" as const,
        },
      },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const msgs = await collectMessages(codexSDK.query(makeQueryParams()));

    expect(msgs).toContainEqual(
      expect.objectContaining({
        type: "event",
        event_type: "command_execution",
      }),
    );
  });

  it("yields a success result with structured_output on turn.completed when outputFormat is set", async () => {
    const structuredJson = JSON.stringify({
      transition: "success",
      reason: "done",
      handoff_summary: "all good",
    });
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: structuredJson },
      },
      {
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const params = makeQueryParams({
      outputFormat: {
        type: "json_schema",
        schema: { type: "object", properties: {} },
      },
    });
    const msgs = await collectMessages(codexSDK.query(params));

    const result = msgs.find((m) => m.type === "result");
    expect(result).toEqual({
      type: "result",
      subtype: "success",
      result: structuredJson,
      structured_output: {
        transition: "success",
        reason: "done",
        handoff_summary: "all good",
      },
    });
  });

  it("yields a success result without structured_output when outputFormat is not set", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "plain text answer" },
      },
      {
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const msgs = await collectMessages(codexSDK.query(makeQueryParams()));

    const result = msgs.find((m) => m.type === "result");
    expect(result).toEqual({
      type: "result",
      subtype: "success",
      result: "plain text answer",
      structured_output: undefined,
    });
  });

  it("yields an error result on turn.failed", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "rate limit exceeded" } },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const msgs = await collectMessages(codexSDK.query(makeQueryParams()));

    const result = msgs.find((m) => m.type === "result");
    expect(result).toEqual({
      type: "result",
      subtype: "error",
      result: "rate limit exceeded",
    });
  });

  it("yields an error result on ThreadErrorEvent", async () => {
    const events: ThreadEvent[] = [{ type: "error", message: "stream error" }];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    const msgs = await collectMessages(codexSDK.query(makeQueryParams()));

    const result = msgs.find((m) => m.type === "result");
    expect(result).toEqual({
      type: "result",
      subtype: "error",
      result: "stream error",
    });
  });

  it("passes model and cwd to startThread", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ model: "o3", cwd: "/my/repo" })),
    );

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "o3",
        workingDirectory: "/my/repo",
        sandboxMode: "workspace-write",
        skipGitRepoCheck: true,
      }),
    );
  });

  it("maps permissionMode acceptEdits to workspace-write sandbox", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ permissionMode: "acceptEdits" })),
    );

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "workspace-write" }),
    );
  });

  it("maps other permissionMode to read-only sandbox", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ permissionMode: "plan" })),
    );

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "read-only" }),
    );
  });

  it("passes outputSchema to runStreamed turnOptions", async () => {
    const schema = { type: "object", properties: { foo: { type: "string" } } };
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(
        makeQueryParams({ outputFormat: { type: "json_schema", schema } }),
      ),
    );

    expect(runStreamedMock).toHaveBeenCalledWith(
      "do something",
      expect.objectContaining({ outputSchema: schema }),
    );
  });

  it("passes abort signal to runStreamed turnOptions", async () => {
    const ac = new AbortController();
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ abortController: ac })),
    );

    expect(runStreamedMock).toHaveBeenCalledWith(
      "do something",
      expect.objectContaining({ signal: ac.signal }),
    );
  });

  it("passes command as codexPathOverride to Codex constructor", async () => {
    const { Codex } = await import("@openai/codex-sdk");
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ command: "/usr/local/bin/codex" })),
    );

    expect(Codex).toHaveBeenCalledWith(
      expect.objectContaining({ codexPathOverride: "/usr/local/bin/codex" }),
    );
  });
});

describe("codexSDK.buildTransitionOutputFormat", () => {
  it("produces a schema with enum transition names", () => {
    const format = codexSDK.buildTransitionOutputFormat([
      { state: "review", when: "code is ready" },
      { terminal: "success", when: "all done" },
    ]);

    expect(format.type).toBe("json_schema");
    expect(format.schema).toEqual({
      type: "object",
      properties: {
        transition: { type: "string", enum: ["review", "success"] },
        reason: { type: "string" },
        handoff_summary: { type: "string" },
      },
      required: ["transition", "reason", "handoff_summary"],
      additionalProperties: false,
    });
  });
});
