import type { ThreadEvent } from "@openai/codex-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTransitionOutputFormatForCodex } from "./codex-sdk";
import type { AgentMessage, AgentQueryParams } from "./runtime";

// Undo the global test-setup mock so we can test the real wrapper module.
vi.unmock("@/backend/domain/agent/codex-sdk");

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const runStreamedMock = vi.fn();
const startThreadMock = vi.fn(() => ({ runStreamed: runStreamedMock }));

vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn(() => ({ startThread: startThreadMock })),
}));

// Import after mocks are set up
const { CodexSDK } = await import("./codex-sdk");
const codexSDK = new CodexSDK();

function makeQueryParams(
  overrides?: Partial<AgentQueryParams>,
): AgentQueryParams {
  return {
    sessionId: "sess-1",
    prompt: "do something",
    cwd: "/tmp/repo",
    permissionMode: "edit",
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

  it("maps permissionMode edit to workspace-write sandbox with no network", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ permissionMode: "edit" })),
    );

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: "workspace-write",
        networkAccessEnabled: false,
        approvalPolicy: "never",
      }),
    );
  });

  it("maps permissionMode full to danger-full-access sandbox with network", async () => {
    const events: ThreadEvent[] = [
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      },
    ];
    runStreamedMock.mockResolvedValue({ events: eventsFromArray(events) });

    await collectMessages(
      codexSDK.query(makeQueryParams({ permissionMode: "full" })),
    );

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        approvalPolicy: "never",
      }),
    );
  });

  it("maps permissionMode plan to read-only sandbox with no network", async () => {
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
      expect.objectContaining({
        sandboxMode: "read-only",
        networkAccessEnabled: false,
        approvalPolicy: "never",
      }),
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

describe("buildTransitionOutputFormatForCodex", () => {
  it("restricts transition to the configured state and terminal names", () => {
    const outputFormat = buildTransitionOutputFormatForCodex([
      { step: "plan", when: "needs clarification" },
      { step: "implement", when: "plan is ready" },
      { terminal: "failure", when: "blocked" },
    ]);

    expect(outputFormat).toEqual({
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          transition: {
            type: "string",
            enum: ["plan", "implement", "failure"],
          },
          reason: { type: "string" },
          handoff_summary: { type: "string" },
        },
        required: ["transition", "reason", "handoff_summary"],
        additionalProperties: false,
      },
    });
  });

  it("includes metadata fields in required to satisfy Codex json_schema validation", () => {
    const outputFormat = buildTransitionOutputFormatForCodex(
      [{ terminal: "success", when: "done" }],
      {
        pr_url: { type: "string", description: "The pull request URL" },
        pr_number: { type: "string" },
      },
    );

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(properties.pr_url).toEqual({
      type: "string",
      description: "The pull request URL",
    });
    expect(properties.pr_number).toEqual({ type: "string" });

    expect(schema.required).toEqual([
      "transition",
      "reason",
      "handoff_summary",
      "pr_url",
      "pr_number",
    ]);
  });

  it("ignores metadata fields that collide with core decision keys", () => {
    const outputFormat = buildTransitionOutputFormatForCodex(
      [{ terminal: "success", when: "done" }],
      {
        transition: { type: "string", description: "collides" },
        reason: { type: "string" },
        pr_url: { type: "string", description: "The pull request URL" },
      },
    );

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(properties.transition).toEqual({
      type: "string",
      enum: ["success"],
    });
    expect(properties.reason).toEqual({ type: "string" });

    expect(properties.pr_url).toEqual({
      type: "string",
      description: "The pull request URL",
    });
  });

  it("works without metadata (backward compat)", () => {
    const outputFormat = buildTransitionOutputFormatForCodex([
      { terminal: "success", when: "done" },
    ]);

    const schema = outputFormat.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(Object.keys(properties)).toEqual([
      "transition",
      "reason",
      "handoff_summary",
    ]);
  });
});
