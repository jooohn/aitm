import { randomUUID } from "crypto";
import { unlink } from "fs/promises";
import { join } from "path";
import type {
  AgentConfig,
  AgentProvider,
  WorkflowDefinition,
} from "@/backend/infra/config";
import { logger } from "@/backend/infra/logger";
import { appendToLog } from "@/backend/utils/log";
import type { AgentRuntime, ForkSessionResult } from "../agent/runtime";
import type { BranchNameService } from "../branch-name";
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../errors";
import type { RepositoryService } from "../repositories";
import type { WorkflowRunService } from "../workflow-runs";
import { filterWorkflowsForRepository } from "../workflows/filter";
import type { WorktreeService } from "../worktrees";
import { ChatAgent, chatsLogDir } from "./chat-agent";
import type { ChatRepository } from "./chat-repository";
import { ProposalService } from "./proposal-service";
import { buildSystemPrompt } from "./system-prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatStatus = "running" | "awaiting_input" | "idle" | "failed";
export type ChatProposalStatus = "pending" | "approved" | "rejected";

export interface Chat {
  id: string;
  repository_path: string;
  title: string | null;
  status: ChatStatus;
  agent_config: AgentConfig;
  log_file_path: string;
  claude_session_id: string | null;
  parent_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatProposal {
  id: string;
  chat_id: string;
  workflow_name: string;
  inputs: Record<string, string>;
  rationale: string;
  status: ChatProposalStatus;
  workflow_run_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// ChatService
// ---------------------------------------------------------------------------

export class ChatService {
  private chatAgent: ChatAgent;
  private proposalService: ProposalService;
  private runtimes: Record<AgentProvider, AgentRuntime>;

  constructor(
    private chatRepository: ChatRepository,
    runtimes: Record<AgentProvider, AgentRuntime>,
    worktreeService: WorktreeService,
    workflowRunService: WorkflowRunService,
    branchNameService: BranchNameService,
    private defaultAgentConfig: AgentConfig,
    private workflows: Record<string, WorkflowDefinition>,
    private repositoryService?: RepositoryService,
  ) {
    this.runtimes = runtimes;
    this.chatAgent = new ChatAgent(runtimes, chatRepository, workflows);
    this.proposalService = new ProposalService(
      chatRepository,
      worktreeService,
      workflowRunService,
      branchNameService,
      this.chatAgent,
      workflows,
      repositoryService,
    );
  }

  private resolveWorkflows(
    repositoryPath: string,
  ): Record<string, WorkflowDefinition> {
    const configRepo = this.repositoryService?.getConfigForPath(repositoryPath);
    return filterWorkflowsForRepository(this.workflows, configRepo);
  }

  // -- CRUD --

  async createChat(repositoryPath: string): Promise<Chat> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const log_file_path = join(await chatsLogDir(), `${id}.log`);
    const agentConfig: AgentConfig = {
      ...this.defaultAgentConfig,
      permission_mode: "plan",
    };

    this.chatRepository.insertChat({
      id,
      repository_path: repositoryPath,
      title: null,
      agent_config: agentConfig,
      log_file_path,
      now,
    });

    return this.chatRepository.getChat(id) as Chat;
  }

  getChat(id: string): Chat | undefined {
    return this.chatRepository.getChat(id);
  }

  listChats(repositoryPath?: string): Chat[] {
    return this.chatRepository.listChats(repositoryPath);
  }

  listProposals(chatId: string): ChatProposal[] {
    return this.chatRepository.listProposals(chatId);
  }

  async closeChat(id: string): Promise<boolean> {
    const chat = this.chatRepository.getChat(id);
    if (!chat) return false;

    this.chatAgent.cancelAgent(id);

    try {
      await unlink(chat.log_file_path);
    } catch {
      // ignore missing files
    }

    return this.chatRepository.deleteChat(id);
  }

  // -- Messaging --

  async sendMessage(chatId: string, message: string): Promise<void> {
    const chat = this.chatRepository.getChat(chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);
    if (chat.status === "running") {
      throw new ConflictError(`Chat ${chatId} is already running`);
    }

    const now = new Date().toISOString();
    this.chatRepository.setChatStatus(chatId, "running", now);

    if (!chat.title) {
      const title =
        message.length > 80 ? `${message.slice(0, 77)}...` : message;
      this.chatRepository.setChatTitle(chatId, title, now);
    }

    await appendToLog(chat.log_file_path, { type: "user_input", message });

    const isFirstMessage = !chat.claude_session_id;
    const activeWorkflows = this.resolveWorkflows(chat.repository_path);
    const systemPrompt = buildSystemPrompt(
      chat.repository_path,
      activeWorkflows,
    );

    const prompt = isFirstMessage
      ? `${systemPrompt}\n\n---\n\nUser message:\n${message}`
      : message;

    this.chatAgent
      .runAgent(chatId, chat, prompt, isFirstMessage, message, activeWorkflows)
      .catch((err) =>
        logger.error({ err, chatId }, "Failed to run chat agent"),
      );
  }

  // -- Proposals --

  async approveProposal(
    chatId: string,
    proposalId: string,
    overrides?: { workflow_name?: string; inputs?: Record<string, string> },
  ): Promise<{ workflowRunId: string }> {
    return this.proposalService.approveProposal(chatId, proposalId, overrides);
  }

  async rejectProposal(
    chatId: string,
    proposalId: string,
    reason?: string,
  ): Promise<void> {
    return this.proposalService.rejectProposal(chatId, proposalId, reason);
  }

  // -- Dive Deep --

  async diveDeep(
    chatId: string,
    proposalId: string,
  ): Promise<{ chatId: string }> {
    const chat = this.chatRepository.getChat(chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);

    const proposal = this.chatRepository.getProposal(proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.chat_id !== chatId) {
      throw new ValidationError("Proposal does not belong to this chat");
    }
    if (proposal.status !== "pending") {
      throw new ValidationError("Cannot dive deep on a non-pending proposal");
    }

    if (!chat.claude_session_id) {
      throw new ValidationError(
        "Cannot fork: parent chat has no active session",
      );
    }

    const runtime = this.runtimes[chat.agent_config.provider];
    if (!runtime?.fork) {
      throw new ServiceUnavailableError(
        `Provider "${chat.agent_config.provider}" does not support fork`,
      );
    }

    const forkResult: ForkSessionResult = await runtime.fork(
      chat.claude_session_id,
      {
        dir: chat.repository_path,
        title: `Dive deep: ${proposal.rationale}`,
      },
    );

    const newChatId = randomUUID();
    const now = new Date().toISOString();
    const log_file_path = join(await chatsLogDir(), `${newChatId}.log`);

    this.chatRepository.insertChat({
      id: newChatId,
      repository_path: chat.repository_path,
      title: `Dive deep: ${proposal.rationale.length > 60 ? `${proposal.rationale.slice(0, 57)}...` : proposal.rationale}`,
      agent_config: chat.agent_config,
      log_file_path,
      claude_session_id: forkResult.sessionId,
      parent_chat_id: chatId,
      now,
    });

    const seedingMessage = `Let's dive deeper into this suggestion: "${proposal.rationale}"\n\nWorkflow: ${proposal.workflow_name}\nInputs: ${JSON.stringify(proposal.inputs, null, 2)}\n\nHelp me refine the scope or break it into smaller workflow-runs.`;

    this.chatRepository.setChatStatus(newChatId, "running", now);

    const newChat = this.chatRepository.getChat(newChatId)!;
    const activeWorkflows = this.resolveWorkflows(chat.repository_path);
    this.chatAgent
      .runAgent(
        newChatId,
        newChat,
        seedingMessage,
        false,
        undefined,
        activeWorkflows,
      )
      .catch((err) =>
        logger.error(
          { err, chatId: newChatId },
          "Failed to run dive-deep chat agent",
        ),
      );

    return { chatId: newChatId };
  }

  // -- Recovery --

  recoverCrashedChats(): void {
    this.chatRepository.recoverCrashedChats();
  }
}
