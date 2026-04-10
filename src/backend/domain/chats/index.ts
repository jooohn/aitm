import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { access, constants, mkdir, unlink, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import type {
  AgentConfig,
  AgentProvider,
  WorkflowDefinition,
} from "@/backend/infra/config";
import { logger } from "@/backend/infra/logger";
import { appendToLog } from "@/backend/utils/log";
import type {
  AgentMessage,
  AgentRuntime,
  OutputFormat,
} from "../agent/runtime";
import type { BranchNameService } from "../branch-name";
import { ConflictError, NotFoundError } from "../errors";
import type { WorkflowRunService } from "../workflow-runs";
import type { WorktreeService } from "../worktrees";
import type { ChatRepository } from "./chat-repository";

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

interface RawProposal {
  workflow_name: string;
  inputs: Record<string, string>;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Read-only tool allowlist
// ---------------------------------------------------------------------------

const CHAT_TOOLS: string[] = [
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "LSP",
  "Agent",
  "ToolSearch",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
];

// ---------------------------------------------------------------------------
// Structured output schema for proposals
// ---------------------------------------------------------------------------

const CHAT_OUTPUT_FORMAT: OutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            workflow_name: { type: "string" },
            inputs: { type: "object" },
            rationale: { type: "string" },
          },
          required: ["workflow_name", "inputs", "rationale"],
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function chatsLogDir(): Promise<string> {
  const candidates = [
    process.env.AITM_SESSION_LOG_DIR,
    process.env.AITM_SESSIONS_DIR,
    join(homedir(), ".aitm", "chats"),
    join(tmpdir(), "aitm", "chats"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const dir of candidates) {
    try {
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      return dir;
    } catch {
      // Try the next writable location.
    }
  }

  throw new Error("Unable to create a writable chat log directory");
}

function buildWorkflowContext(
  workflows: Record<string, WorkflowDefinition>,
): string {
  const entries = Object.entries(workflows);
  if (entries.length === 0) return "No workflows are configured.";

  return `Available workflows (full configuration):\n${JSON.stringify(workflows, null, 2)}`;
}

function buildSystemPrompt(
  repositoryPath: string,
  workflows: Record<string, WorkflowDefinition>,
): string {
  return [
    "You are a planning assistant for a code repository. Your role is to help the user brainstorm, explore the codebase, and propose workflow-runs.",
    "",
    `Repository: ${repositoryPath}`,
    "",
    buildWorkflowContext(workflows),
    "",
    "When you have concrete, actionable suggestions for workflow-runs, include them in your structured output's `proposals` array.",
    "Each proposal must have: workflow_name (one of the available workflows), inputs (matching the workflow's input schema), and rationale (why this workflow-run is being suggested).",
    'For normal conversational turns (answering questions, exploring code, discussing ideas), emit "proposals": [].',
    "",
    "IMPORTANT: Workflow-runs execute independently with NO access to this conversation's context.",
    "Every workflow-run input must be entirely self-contained — include all relevant context, background, reasoning, and the 'why' behind the request.",
    "Do not assume the workflow-run agent knows what was discussed here; spell out the full intent and any constraints explicitly in the input values.",
    "",
    "You have read-only access to the codebase. You cannot modify files.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// ChatService
// ---------------------------------------------------------------------------

export class ChatService {
  private activeAbortControllers = new Map<string, AbortController>();

  constructor(
    private chatRepository: ChatRepository,
    private runtimes: Record<AgentProvider, AgentRuntime>,
    private worktreeService: WorktreeService,
    private workflowRunService: WorkflowRunService,
    private branchNameService: BranchNameService,
    private defaultAgentConfig: AgentConfig,
    private workflows: Record<string, WorkflowDefinition>,
  ) {}

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

    // Cancel any running agent
    this.cancelAgent(id);

    // Delete log file
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

    // Auto-title from the first message
    if (!chat.title) {
      const title =
        message.length > 80 ? `${message.slice(0, 77)}...` : message;
      this.chatRepository.setChatTitle(chatId, title, now);
    }

    // Log the user message
    await appendToLog(chat.log_file_path, { type: "user_input", message });

    const isFirstMessage = !chat.claude_session_id;
    const systemPrompt = buildSystemPrompt(
      chat.repository_path,
      this.workflows,
    );

    const prompt = isFirstMessage
      ? `${systemPrompt}\n\n---\n\nUser message:\n${message}`
      : message;

    this.runAgent(chatId, chat, prompt, isFirstMessage, message).catch((err) =>
      logger.error({ err, chatId }, "Failed to run chat agent"),
    );
  }

  // -- Proposals --

  async approveProposal(
    chatId: string,
    proposalId: string,
    overrides?: { workflow_name?: string; inputs?: Record<string, string> },
  ): Promise<{ workflowRunId: string }> {
    const chat = this.chatRepository.getChat(chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);

    const proposal = this.chatRepository.getProposal(proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.chat_id !== chatId)
      throw new Error("Proposal does not belong to this chat");
    if (proposal.status !== "pending") {
      throw new ConflictError(
        `Proposal ${proposalId} is already ${proposal.status}`,
      );
    }

    const workflowName = overrides?.workflow_name ?? proposal.workflow_name;
    const inputs = overrides?.inputs ?? proposal.inputs;

    // Generate branch name
    const branch = this.branchNameService.generate(workflowName, inputs);

    // Create worktree
    await this.worktreeService.createWorktree(chat.repository_path, branch);

    // Create workflow run
    const run = await this.workflowRunService.createWorkflowRun({
      repository_path: chat.repository_path,
      worktree_branch: branch,
      workflow_name: workflowName,
      inputs,
    });

    // Update proposal status
    const now = new Date().toISOString();
    this.chatRepository.updateProposalStatus(
      proposalId,
      "approved",
      run.id,
      now,
    );

    // Resume agent with confirmation
    const confirmMessage = `Proposal approved: workflow "${workflowName}" started on branch "${branch}" (workflow-run ID: ${run.id}).`;
    await appendToLog(chat.log_file_path, {
      type: "proposal_action",
      proposal_id: proposalId,
      action: "approved",
      workflow_run_id: run.id,
      branch,
    });

    // Resume agent if it's awaiting input
    if (chat.status === "awaiting_input") {
      this.chatRepository.setChatStatus(chatId, "running", now);
      this.runAgent(chatId, chat, confirmMessage, false).catch((err) =>
        logger.error(
          { err, chatId },
          "Failed to resume chat agent after approval",
        ),
      );
    }

    return { workflowRunId: run.id };
  }

  async rejectProposal(
    chatId: string,
    proposalId: string,
    reason?: string,
  ): Promise<void> {
    const chat = this.chatRepository.getChat(chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);

    const proposal = this.chatRepository.getProposal(proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.chat_id !== chatId)
      throw new Error("Proposal does not belong to this chat");
    if (proposal.status !== "pending") {
      throw new ConflictError(
        `Proposal ${proposalId} is already ${proposal.status}`,
      );
    }

    const now = new Date().toISOString();
    this.chatRepository.updateProposalStatus(proposalId, "rejected", null, now);

    await appendToLog(chat.log_file_path, {
      type: "proposal_action",
      proposal_id: proposalId,
      action: "rejected",
      reason: reason ?? null,
    });

    // Resume agent with rejection context
    if (chat.status === "awaiting_input") {
      const rejectMessage = reason
        ? `Proposal rejected: "${proposal.workflow_name}" — Reason: ${reason}`
        : `Proposal rejected: "${proposal.workflow_name}"`;
      this.chatRepository.setChatStatus(chatId, "running", now);
      this.runAgent(chatId, chat, rejectMessage, false).catch((err) =>
        logger.error(
          { err, chatId },
          "Failed to resume chat agent after rejection",
        ),
      );
    }
  }

  // -- Recovery --

  recoverCrashedChats(): void {
    this.chatRepository.recoverCrashedChats();
  }

  // -- Internal --

  private cancelAgent(chatId: string): void {
    const controller = this.activeAbortControllers.get(chatId);
    if (controller) {
      this.activeAbortControllers.delete(chatId);
      controller.abort();
    }
  }

  private async runAgent(
    chatId: string,
    chat: Chat,
    prompt: string,
    isFirstMessage: boolean,
    userMessage?: string,
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(chatId, abortController);

    // Yield to event loop
    await Promise.resolve();

    if (abortController.signal.aborted) {
      this.activeAbortControllers.delete(chatId);
      return;
    }

    if (isFirstMessage) {
      try {
        await writeFile(chat.log_file_path, "", "utf8");
      } catch {
        // Non-critical
      }
      // Re-append the user message since we cleared the file
      await appendToLog(chat.log_file_path, {
        type: "user_input",
        message: userMessage ?? prompt,
      });
    }

    const runtime = this.selectRuntime(chat.agent_config);

    try {
      let stream: AsyncIterable<AgentMessage>;
      if (isFirstMessage) {
        stream = runtime.query({
          sessionId: chatId,
          prompt,
          cwd: chat.repository_path,
          command: chat.agent_config.command,
          model: chat.agent_config.model,
          permissionMode: "plan",
          abortController,
          outputFormat: CHAT_OUTPUT_FORMAT,
          tools: CHAT_TOOLS,
        });
      } else {
        const claudeSessionId =
          this.chatRepository.getChat(chatId)?.claude_session_id;
        if (!claudeSessionId) {
          throw new Error("Cannot resume: no agent session ID available");
        }
        stream = runtime.resume({
          sessionId: chatId,
          agentSessionId: claudeSessionId,
          prompt,
          cwd: chat.repository_path,
          command: chat.agent_config.command,
          model: chat.agent_config.model,
          permissionMode: "plan",
          abortController,
          outputFormat: CHAT_OUTPUT_FORMAT,
          tools: CHAT_TOOLS,
        });
      }

      const proposals = await this.consumeStream(
        stream,
        chatId,
        chat.log_file_path,
      );

      this.activeAbortControllers.delete(chatId);

      const now = new Date().toISOString();
      if (proposals.length > 0) {
        // Create proposal records
        const proposalRecords = proposals.map((p) => ({
          id: randomUUID(),
          ...p,
        }));
        this.chatRepository.insertProposals(chatId, proposalRecords, now);

        // Log proposal creation for the stream
        await appendToLog(chat.log_file_path, {
          type: "proposals_created",
          proposals: proposalRecords.map((p) => ({
            id: p.id,
            workflow_name: p.workflow_name,
            inputs: p.inputs,
            rationale: p.rationale,
          })),
        });

        this.chatRepository.setChatStatus(chatId, "awaiting_input", now);
      } else {
        this.chatRepository.setChatStatus(chatId, "idle", now);
      }
    } catch (err) {
      if (!(err instanceof AbortError)) {
        await appendToLog(chat.log_file_path, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      this.activeAbortControllers.delete(chatId);
      const now = new Date().toISOString();
      this.chatRepository.setChatStatus(chatId, "failed", now);
    }
  }

  private async consumeStream(
    stream: AsyncIterable<AgentMessage>,
    chatId: string,
    logFilePath: string,
  ): Promise<RawProposal[]> {
    let proposals: RawProposal[] = [];

    for await (const message of stream) {
      await appendToLog(logFilePath, message);

      if (message.type === "system" && message.subtype === "init") {
        if (message.session_id) {
          this.chatRepository.setChatClaudeSessionId(
            chatId,
            message.session_id,
          );
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        const raw = message.structured_output as
          | { proposals?: unknown[] }
          | undefined;
        if (raw?.proposals && Array.isArray(raw.proposals)) {
          proposals = raw.proposals
            .filter(
              (p): p is RawProposal =>
                typeof p === "object" &&
                p !== null &&
                "workflow_name" in p &&
                "inputs" in p &&
                "rationale" in p,
            )
            .filter((p) => p.workflow_name in this.workflows);
        }
      }
    }

    return proposals;
  }

  private selectRuntime(agentConfig: AgentConfig): AgentRuntime {
    const runtime = this.runtimes[agentConfig.provider];
    if (!runtime) {
      throw new Error(
        `No agent runtime configured for provider: ${agentConfig.provider}`,
      );
    }
    return runtime;
  }
}
