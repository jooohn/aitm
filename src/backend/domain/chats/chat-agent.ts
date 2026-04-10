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
  buildChatOutputFormat,
  buildSystemPrompt,
  CHAT_TOOLS,
} from "./system-prompt";

export interface RawProposal {
  workflow_name: string;
  inputs: Record<string, string>;
  rationale: string;
}

function normalizeProposalInputs(
  value: unknown,
): Record<string, string> | null {
  if (Array.isArray(value)) {
    const inputs: Record<string, string> = {};
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return null;
      }

      const pair = entry as Record<string, unknown>;
      if (typeof pair.name !== "string" || typeof pair.value !== "string") {
        return null;
      }

      inputs[pair.name] = pair.value;
    }
    return inputs;
  }

  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const inputs: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") return null;
    inputs[key] = entryValue;
  }
  return inputs;
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
            .map((proposal) => {
              if (
                typeof proposal !== "object" ||
                proposal === null ||
                Array.isArray(proposal)
              ) {
                return null;
              }

              const candidate = proposal as Record<string, unknown>;
              if (
                typeof candidate.workflow_name !== "string" ||
                typeof candidate.rationale !== "string"
              ) {
                return null;
              }

              const inputs = normalizeProposalInputs(candidate.inputs);
              if (inputs === null) return null;

              return {
                workflow_name: candidate.workflow_name,
                inputs,
                rationale: candidate.rationale,
              } satisfies RawProposal;
            })
            .filter((p): p is RawProposal => p !== null)
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
    const outputFormat = buildChatOutputFormat(this.workflows);

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
          outputFormat,
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
          outputFormat,
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
