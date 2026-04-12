import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "../agent/runtime";
import type { BranchNameService } from "../branch-name";
import type { WorkflowRunService } from "../workflow-runs";
import type { WorktreeService } from "../worktrees";
import type { Chat, ChatProposal } from ".";
import { ChatService } from ".";
import type { ChatRepository } from "./chat-repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    repository_path: "/repo",
    title: "Test chat",
    status: "awaiting_input",
    agent_config: { provider: "claude" },
    log_file_path: "/tmp/test-chat.log",
    claude_session_id: "session-1",
    parent_chat_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProposal(overrides: Partial<ChatProposal> = {}): ChatProposal {
  return {
    id: "proposal-1",
    chat_id: "chat-1",
    workflow_name: "dev-flow",
    inputs: { description: "Add feature" },
    rationale: "Needed for users",
    status: "pending",
    workflow_run_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function* emptyStream() {
  // yields nothing
}

function makeMockRuntime(): AgentRuntime {
  return {
    query: vi.fn(() => emptyStream()),
    resume: vi.fn(() => emptyStream()),
    fork: vi.fn().mockResolvedValue({ sessionId: "forked-session-1" }),
    buildTransitionOutputFormat: vi.fn(),
  };
}

function makeMockDeps() {
  const chatRepository = {
    getChat: vi.fn(),
    getProposal: vi.fn(),
    insertChat: vi.fn(),
    setChatStatus: vi.fn(),
    setChatTitle: vi.fn(),
    setChatClaudeSessionId: vi.fn(),
    listProposals: vi.fn().mockReturnValue([]),
    insertProposals: vi.fn(),
    updateProposalStatus: vi.fn(),
    listChats: vi.fn().mockReturnValue([]),
    deleteChat: vi.fn(),
    recoverCrashedChats: vi.fn(),
    ensureTables: vi.fn(),
  } as unknown as ChatRepository;

  const worktreeService = {
    createWorktree: vi.fn().mockResolvedValue({ branch: "feat/test" }),
  } as unknown as WorktreeService;

  const workflowRunService = {
    createWorkflowRun: vi
      .fn()
      .mockResolvedValue({ id: "run-1", status: "pending" }),
  } as unknown as WorkflowRunService;

  const branchNameService = {
    generate: vi.fn().mockReturnValue("feat/add-feature-abc1"),
  } as unknown as BranchNameService;

  const claudeRuntime = makeMockRuntime();
  const codexRuntime = {
    query: vi.fn(() => emptyStream()),
    resume: vi.fn(() => emptyStream()),
    fork: undefined,
    buildTransitionOutputFormat: vi.fn(),
  } as unknown as AgentRuntime;

  return {
    chatRepository,
    worktreeService,
    workflowRunService,
    branchNameService,
    claudeRuntime,
    codexRuntime,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatService.diveDeep", () => {
  let deps: ReturnType<typeof makeMockDeps>;
  let service: ChatService;

  beforeEach(() => {
    deps = makeMockDeps();
    service = new ChatService(
      deps.chatRepository,
      { claude: deps.claudeRuntime, codex: deps.codexRuntime },
      deps.worktreeService,
      deps.workflowRunService,
      deps.branchNameService,
      { provider: "claude" },
      { "dev-flow": { initial_step: "plan", steps: {} } },
    );
  });

  it("forks the session, creates a new chat with parent_chat_id, and sends a seeding message", async () => {
    const chat = makeChat();
    const proposal = makeProposal();
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chat) // initial lookup
      .mockReturnValue(
        makeChat({
          id: "new-chat-id",
          claude_session_id: "forked-session-1",
          parent_chat_id: "chat-1",
        }),
      ); // after insert
    (
      deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
    ).mockReturnValue(proposal);

    const result = await service.diveDeep("chat-1", "proposal-1");

    expect(result.chatId).toBeDefined();
    expect(typeof result.chatId).toBe("string");

    expect(deps.claudeRuntime.fork).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        dir: "/repo",
        title: expect.stringContaining("Dive deep"),
      }),
    );

    expect(deps.chatRepository.insertChat).toHaveBeenCalledWith(
      expect.objectContaining({
        parent_chat_id: "chat-1",
      }),
    );
  });

  it("throws when parent chat not found", async () => {
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
      undefined,
    );

    await expect(service.diveDeep("missing", "proposal-1")).rejects.toThrow(
      /Chat not found/,
    );
  });

  it("throws when proposal not found", async () => {
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChat(),
    );
    (
      deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
    ).mockReturnValue(undefined);

    await expect(service.diveDeep("chat-1", "missing")).rejects.toThrow(
      /Proposal not found/,
    );
  });

  it("throws ValidationError when proposal does not belong to the chat", async () => {
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChat(),
    );
    (
      deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
    ).mockReturnValue(makeProposal({ chat_id: "other-chat" }));

    await expect(service.diveDeep("chat-1", "proposal-1")).rejects.toThrow(
      /does not belong/,
    );
    await expect(service.diveDeep("chat-1", "proposal-1")).rejects.toThrow(
      expect.objectContaining({ name: "ValidationError" }),
    );
  });

  it("throws ValidationError when proposal is not pending", async () => {
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChat(),
    );
    (
      deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
    ).mockReturnValue(makeProposal({ status: "approved" }));

    await expect(service.diveDeep("chat-1", "proposal-1")).rejects.toThrow(
      /pending/i,
    );
  });

  it("throws when parent chat has no claude_session_id", async () => {
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
      makeChat({ claude_session_id: null }),
    );
    (
      deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
    ).mockReturnValue(makeProposal());

    await expect(service.diveDeep("chat-1", "proposal-1")).rejects.toThrow(
      /session/i,
    );
  });

  it("throws when runtime does not support fork", async () => {
    const chat = makeChat({ agent_config: { provider: "codex" } });
    (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
      chat,
    );
    (
      deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
    ).mockReturnValue(makeProposal());

    await expect(service.diveDeep("chat-1", "proposal-1")).rejects.toThrow(
      /fork/i,
    );
  });
});
