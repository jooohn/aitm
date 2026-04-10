import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchNameService } from "../branch-name";
import type { WorkflowRunService } from "../workflow-runs";
import type { WorktreeService } from "../worktrees";
import type { Chat, ChatProposal } from ".";
import type { ChatAgent } from "./chat-agent";
import type { ChatRepository } from "./chat-repository";
import { ProposalService } from "./proposal-service";

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

function makeMockDeps() {
  const chatRepository = {
    getChat: vi.fn(),
    getProposal: vi.fn(),
    updateProposalStatus: vi.fn(),
    setChatStatus: vi.fn(),
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

  const chatAgent = {
    runAgent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatAgent;

  return {
    chatRepository,
    worktreeService,
    workflowRunService,
    branchNameService,
    chatAgent,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProposalService", () => {
  let deps: ReturnType<typeof makeMockDeps>;
  let service: ProposalService;

  beforeEach(() => {
    deps = makeMockDeps();
    service = new ProposalService(
      deps.chatRepository,
      deps.worktreeService,
      deps.workflowRunService,
      deps.branchNameService,
      deps.chatAgent,
    );
  });

  describe("approveProposal", () => {
    it("creates worktree, workflow run, and updates proposal status", async () => {
      const chat = makeChat();
      const proposal = makeProposal();
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        chat,
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(proposal);

      const result = await service.approveProposal("chat-1", "proposal-1");

      expect(deps.branchNameService.generate).toHaveBeenCalledWith("dev-flow", {
        description: "Add feature",
      });
      expect(deps.worktreeService.createWorktree).toHaveBeenCalledWith(
        "/repo",
        "feat/add-feature-abc1",
      );
      expect(deps.workflowRunService.createWorkflowRun).toHaveBeenCalledWith({
        repository_path: "/repo",
        worktree_branch: "feat/add-feature-abc1",
        workflow_name: "dev-flow",
        inputs: { description: "Add feature" },
      });
      expect(deps.chatRepository.updateProposalStatus).toHaveBeenCalledWith(
        "proposal-1",
        "approved",
        "run-1",
        expect.any(String),
      );
      expect(result.workflowRunId).toBe("run-1");
    });

    it("resumes agent when chat is awaiting_input", async () => {
      const chat = makeChat({ status: "awaiting_input" });
      const proposal = makeProposal();
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        chat,
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(proposal);

      await service.approveProposal("chat-1", "proposal-1");

      expect(deps.chatRepository.setChatStatus).toHaveBeenCalledWith(
        "chat-1",
        "running",
        expect.any(String),
      );
      expect(deps.chatAgent.runAgent).toHaveBeenCalledWith(
        "chat-1",
        chat,
        expect.stringContaining("approved"),
        false,
      );
    });

    it("applies overrides to workflow_name and inputs", async () => {
      const chat = makeChat();
      const proposal = makeProposal();
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        chat,
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(proposal);

      await service.approveProposal("chat-1", "proposal-1", {
        workflow_name: "bugfix-flow",
        inputs: { description: "Fix bug" },
      });

      expect(deps.branchNameService.generate).toHaveBeenCalledWith(
        "bugfix-flow",
        { description: "Fix bug" },
      );
    });

    it("throws when chat not found", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );

      await expect(
        service.approveProposal("missing", "proposal-1"),
      ).rejects.toThrow(/Chat not found/);
    });

    it("throws when proposal not found", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        makeChat(),
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(undefined);

      await expect(
        service.approveProposal("chat-1", "missing"),
      ).rejects.toThrow(/Proposal not found/);
    });

    it("throws when proposal belongs to a different chat", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        makeChat(),
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(makeProposal({ chat_id: "other-chat" }));

      await expect(
        service.approveProposal("chat-1", "proposal-1"),
      ).rejects.toThrow(/does not belong/);
    });

    it("throws when proposal is already approved", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        makeChat(),
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(makeProposal({ status: "approved" }));

      await expect(
        service.approveProposal("chat-1", "proposal-1"),
      ).rejects.toThrow(/already approved/);
    });
  });

  describe("rejectProposal", () => {
    it("updates proposal status to rejected", async () => {
      const chat = makeChat();
      const proposal = makeProposal();
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        chat,
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(proposal);

      await service.rejectProposal("chat-1", "proposal-1");

      expect(deps.chatRepository.updateProposalStatus).toHaveBeenCalledWith(
        "proposal-1",
        "rejected",
        null,
        expect.any(String),
      );
    });

    it("resumes agent with rejection reason when awaiting_input", async () => {
      const chat = makeChat({ status: "awaiting_input" });
      const proposal = makeProposal();
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        chat,
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(proposal);

      await service.rejectProposal(
        "chat-1",
        "proposal-1",
        "Not the right approach",
      );

      expect(deps.chatAgent.runAgent).toHaveBeenCalledWith(
        "chat-1",
        chat,
        expect.stringContaining("Not the right approach"),
        false,
      );
    });

    it("resumes agent without reason when none is given", async () => {
      const chat = makeChat({ status: "awaiting_input" });
      const proposal = makeProposal();
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        chat,
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(proposal);

      await service.rejectProposal("chat-1", "proposal-1");

      expect(deps.chatAgent.runAgent).toHaveBeenCalledWith(
        "chat-1",
        chat,
        expect.stringContaining("rejected"),
        false,
      );
    });

    it("throws when chat not found", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );

      await expect(
        service.rejectProposal("missing", "proposal-1"),
      ).rejects.toThrow(/Chat not found/);
    });

    it("throws when proposal not found", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        makeChat(),
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(undefined);

      await expect(service.rejectProposal("chat-1", "missing")).rejects.toThrow(
        /Proposal not found/,
      );
    });

    it("throws when proposal is already rejected", async () => {
      (deps.chatRepository.getChat as ReturnType<typeof vi.fn>).mockReturnValue(
        makeChat(),
      );
      (
        deps.chatRepository.getProposal as ReturnType<typeof vi.fn>
      ).mockReturnValue(makeProposal({ status: "rejected" }));

      await expect(
        service.rejectProposal("chat-1", "proposal-1"),
      ).rejects.toThrow(/already rejected/);
    });
  });
});
