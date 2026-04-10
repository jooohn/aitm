import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { access, constants, mkdir, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import type {
  AgentConfig,
  AgentProvider,
  WorkflowDefinition,
} from "@/backend/infra/config";
import { logger } from "@/backend/infra/logger";
import { appendToLog } from "@/backend/utils/log";
import type { AgentMessage, AgentRuntime } from "../agent/runtime";
import type { Chat } from ".";
import type { ChatRepository } from "./chat-repository";
import {
  buildSystemPrompt,
  CHAT_OUTPUT_FORMAT,
  CHAT_TOOLS,
} from "./system-prompt";

export interface RawProposal {
  workflow_name: string;
  inputs: Record<string, string>;
  rationale: string;
}

export async function chatsLogDir(): Promise<string> {
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

export class ChatAgent {
  private activeAbortControllers = new Map<string, AbortController>();

  constructor(
    private runtimes: Record<AgentProvider, AgentRuntime>,
    private chatRepository: ChatRepository,
    private workflows: Record<string, WorkflowDefinition>,
  ) {}

  selectRuntime(agentConfig: AgentConfig): AgentRuntime {
    const runtime = this.runtimes[agentConfig.provider];
    if (!runtime) {
      throw new Error(
        `No agent runtime configured for provider: ${agentConfig.provider}`,
      );
    }
    return runtime;
  }

  cancelAgent(chatId: string): void {
    const controller = this.activeAbortControllers.get(chatId);
    if (controller) {
      this.activeAbortControllers.delete(chatId);
      controller.abort();
    }
  }

  setAbortController(chatId: string, controller: AbortController): void {
    this.activeAbortControllers.set(chatId, controller);
  }

  async consumeStream(
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

  async runAgent(
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
        const proposalRecords = proposals.map((p) => ({
          id: randomUUID(),
          ...p,
        }));
        this.chatRepository.insertProposals(chatId, proposalRecords, now);

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
}
