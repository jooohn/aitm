import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "@/backend/infra/config";
import type { AgentMessage, AgentRuntime } from "../agent/runtime";
import type { Chat } from ".";
import { ChatAgent } from "./chat-agent";
import type { ChatRepository } from "./chat-repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    repository_path: "/repo",
    title: "Test chat",
    status: "running",
    agent_config: { provider: "claude" },
    log_file_path: "/tmp/test-chat.log",
    claude_session_id: "session-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function* asyncIterableFrom(
  messages: AgentMessage[],
): AsyncIterable<AgentMessage> {
  for (const msg of messages) {
    yield msg;
  }
}

function makeMockRuntime(): AgentRuntime {
  return {
    query: vi.fn(() => asyncIterableFrom([])),
    resume: vi.fn(() => asyncIterableFrom([])),
    buildTransitionOutputFormat: vi.fn(),
  };
}

function makeMockChatRepository(): ChatRepository {
  return {
    insertChat: vi.fn(),
    getChat: vi.fn(),
    getChatStatus: vi.fn(),
    listChats: vi.fn(),
    deleteChat: vi.fn(),
    setChatStatus: vi.fn(),
    setChatClaudeSessionId: vi.fn(),
    setChatTitle: vi.fn(),
    insertProposals: vi.fn(),
    getProposal: vi.fn(),
    listProposals: vi.fn(),
    updateProposalStatus: vi.fn(),
    recoverCrashedChats: vi.fn(),
    ensureTables: vi.fn(),
  } as unknown as ChatRepository;
}

const workflows: Record<string, WorkflowDefinition> = {
  "dev-flow": {
    initial_step: "plan",
    steps: {
      plan: {
        type: "agent",
        goal: "Plan",
        transitions: [{ terminal: "success" as const, when: "done" }],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatAgent", () => {
  let mockRuntime: AgentRuntime;
  let mockRepo: ChatRepository;
  let agent: ChatAgent;

  beforeEach(() => {
    mockRuntime = makeMockRuntime();
    mockRepo = makeMockChatRepository();
    agent = new ChatAgent(
      { claude: mockRuntime, codex: mockRuntime },
      mockRepo,
      workflows,
    );
  });

  describe("selectRuntime", () => {
    it("returns the runtime for the configured provider", () => {
      const runtime = agent.selectRuntime({ provider: "claude" });
      expect(runtime).toBe(mockRuntime);
    });

    it("throws for unknown provider", () => {
      expect(() =>
        agent.selectRuntime({ provider: "unknown" as never }),
      ).toThrow(/No agent runtime/);
    });
  });

  describe("cancelAgent", () => {
    it("aborts an active controller", () => {
      const controller = new AbortController();
      agent.setAbortController("chat-1", controller);

      agent.cancelAgent("chat-1");

      expect(controller.signal.aborted).toBe(true);
    });

    it("does nothing if no active controller", () => {
      // Should not throw
      agent.cancelAgent("nonexistent");
    });
  });

  describe("consumeStream", () => {
    it("extracts valid proposals from result messages", async () => {
      const messages: AgentMessage[] = [
        {
          type: "result",
          subtype: "success",
          structured_output: {
            proposals: [
              {
                workflow_name: "dev-flow",
                inputs: [{ name: "description", value: "Add feature" }],
                rationale: "Needed for users",
              },
            ],
          },
        },
      ];

      const proposals = await agent.consumeStream(
        asyncIterableFrom(messages),
        "chat-1",
        "/tmp/log",
      );

      expect(proposals).toHaveLength(1);
      expect(proposals[0].workflow_name).toBe("dev-flow");
      expect(proposals[0].inputs).toEqual({ description: "Add feature" });
    });

    it("accepts legacy object-shaped inputs when parsing proposals", async () => {
      const messages: AgentMessage[] = [
        {
          type: "result",
          subtype: "success",
          structured_output: {
            proposals: [
              {
                workflow_name: "dev-flow",
                inputs: { description: "Add feature" },
                rationale: "Needed for users",
              },
            ],
          },
        },
      ];

      const proposals = await agent.consumeStream(
        asyncIterableFrom(messages),
        "chat-1",
        "/tmp/log",
      );

      expect(proposals).toHaveLength(1);
      expect(proposals[0].inputs).toEqual({ description: "Add feature" });
    });

    it("filters out proposals with unknown workflow names", async () => {
      const messages: AgentMessage[] = [
        {
          type: "result",
          subtype: "success",
          structured_output: {
            proposals: [
              {
                workflow_name: "unknown-flow",
                inputs: {},
                rationale: "reason",
              },
              {
                workflow_name: "dev-flow",
                inputs: { desc: "valid" },
                rationale: "reason",
              },
            ],
          },
        },
      ];

      const proposals = await agent.consumeStream(
        asyncIterableFrom(messages),
        "chat-1",
        "/tmp/log",
      );

      expect(proposals).toHaveLength(1);
      expect(proposals[0].workflow_name).toBe("dev-flow");
    });

    it("filters out invalid proposal objects", async () => {
      const messages: AgentMessage[] = [
        {
          type: "result",
          subtype: "success",
          structured_output: {
            proposals: [
              { workflow_name: "dev-flow" }, // missing inputs and rationale
              null,
              "not an object",
            ],
          },
        },
      ];

      const proposals = await agent.consumeStream(
        asyncIterableFrom(messages),
        "chat-1",
        "/tmp/log",
      );

      expect(proposals).toHaveLength(0);
    });

    it("captures session_id from init message", async () => {
      const messages: AgentMessage[] = [
        {
          type: "system",
          subtype: "init",
          session_id: "new-session-id",
        },
        { type: "result", subtype: "success" },
      ];

      await agent.consumeStream(
        asyncIterableFrom(messages),
        "chat-1",
        "/tmp/log",
      );

      expect(mockRepo.setChatClaudeSessionId).toHaveBeenCalledWith(
        "chat-1",
        "new-session-id",
      );
    });

    it("returns empty proposals when result has no structured_output", async () => {
      const messages: AgentMessage[] = [{ type: "result", subtype: "success" }];

      const proposals = await agent.consumeStream(
        asyncIterableFrom(messages),
        "chat-1",
        "/tmp/log",
      );

      expect(proposals).toHaveLength(0);
    });
  });

  describe("runAgent", () => {
    it("sets status to awaiting_input when proposals exist", async () => {
      const chat = makeChat();
      (mockRuntime.query as ReturnType<typeof vi.fn>).mockReturnValue(
        asyncIterableFrom([
          { type: "system", subtype: "init", session_id: "s1" },
          {
            type: "result",
            subtype: "success",
            structured_output: {
              proposals: [
                {
                  workflow_name: "dev-flow",
                  inputs: { desc: "test" },
                  rationale: "reason",
                },
              ],
            },
          },
        ]),
      );

      await agent.runAgent("chat-1", chat, "Hello", true);

      expect(mockRepo.setChatStatus).toHaveBeenCalledWith(
        "chat-1",
        "awaiting_input",
        expect.any(String),
      );
      expect(mockRepo.insertProposals).toHaveBeenCalled();
    });

    it("sets status to idle when no proposals", async () => {
      const chat = makeChat();
      (mockRuntime.query as ReturnType<typeof vi.fn>).mockReturnValue(
        asyncIterableFrom([{ type: "result", subtype: "success" }]),
      );

      await agent.runAgent("chat-1", chat, "Hello", true);

      expect(mockRepo.setChatStatus).toHaveBeenCalledWith(
        "chat-1",
        "idle",
        expect.any(String),
      );
    });

    it("sets status to failed on error", async () => {
      const chat = makeChat();
      (mockRuntime.query as ReturnType<typeof vi.fn>).mockReturnValue(
        (async function* () {
          throw new Error("Runtime error");
        })(),
      );

      await agent.runAgent("chat-1", chat, "Hello", true);

      expect(mockRepo.setChatStatus).toHaveBeenCalledWith(
        "chat-1",
        "failed",
        expect.any(String),
      );
    });

    it("uses resume when not the first message", async () => {
      const chat = makeChat({ claude_session_id: "existing-session" });
      (mockRepo.getChat as ReturnType<typeof vi.fn>).mockReturnValue(chat);
      (mockRuntime.resume as ReturnType<typeof vi.fn>).mockReturnValue(
        asyncIterableFrom([{ type: "result", subtype: "success" }]),
      );

      await agent.runAgent("chat-1", chat, "Follow-up", false);

      expect(mockRuntime.resume).toHaveBeenCalled();
      expect(mockRuntime.query).not.toHaveBeenCalled();
    });
  });
});
