import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_SDK_TOOLS } from "@/backend/domain/agent/claude-common";
import type { AgentMessage, AgentQueryParams } from "./runtime";

vi.unmock("@/backend/domain/agent/claude-sdk");

const queryMock = vi.fn();
const closeMock = vi.fn();
const createAitmMcpServerMock = vi.fn(async () => ({
  close: closeMock,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

vi.mock("@/backend/mcp/runtime-config", () => ({
  createClaudeAitmMcpConfig: vi.fn(async () => ({
    mcpServers: {
      aitm: {
        type: "sdk",
        name: "aitm",
        instance: await createAitmMcpServerMock(),
      },
    },
    close: closeMock,
  })),
}));

const { ClaudeSDK } = await import("./claude-sdk");
const claudeSDK = new ClaudeSDK();

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

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReturnValue(
    (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "ok",
      } satisfies AgentMessage;
    })(),
  );
});

describe("ClaudeSDK", () => {
  it("attaches the aitm MCP server when starting a query", async () => {
    await collectMessages(claudeSDK.query(makeQueryParams()));

    expect(queryMock).toHaveBeenCalledWith({
      prompt: "do something",
      options: expect.objectContaining({
        cwd: "/tmp/repo",
        tools: CLAUDE_SDK_TOOLS,
        mcpServers: {
          aitm: expect.objectContaining({
            type: "sdk",
            name: "aitm",
          }),
        },
      }),
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("attaches the aitm MCP server when resuming a query", async () => {
    await collectMessages(
      claudeSDK.resume({
        ...makeQueryParams(),
        agentSessionId: "thread-123",
      }),
    );

    expect(queryMock).toHaveBeenCalledWith({
      prompt: "do something",
      options: expect.objectContaining({
        resume: "thread-123",
        mcpServers: {
          aitm: expect.objectContaining({
            type: "sdk",
            name: "aitm",
          }),
        },
      }),
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
