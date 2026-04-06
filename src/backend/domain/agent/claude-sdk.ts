import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildTransitionOutputFormatForClaude } from "@/backend/domain/agent/claude-common";
import { toClaudePermissionMode } from "./permission-mode";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentResumeParams,
  AgentRuntime,
} from "./runtime";

export const claudeSDK: AgentRuntime = {
  async *query({
    prompt,
    cwd,
    permissionMode,
    abortController,
    outputFormat,
  }: AgentQueryParams): AsyncIterable<AgentMessage> {
    const result = query({
      prompt,
      options: {
        cwd,
        permissionMode: toClaudePermissionMode(permissionMode),
        abortController,
        outputFormat,
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });

    for await (const message of result) {
      yield message as unknown as AgentMessage;
    }
  },

  async *resume({
    agentSessionId,
    prompt,
    cwd,
    permissionMode,
    abortController,
    outputFormat,
  }: AgentResumeParams): AsyncIterable<AgentMessage> {
    const result = query({
      prompt,
      options: {
        cwd,
        permissionMode: toClaudePermissionMode(permissionMode),
        abortController,
        outputFormat,
        resume: agentSessionId,
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });

    for await (const message of result) {
      yield message as unknown as AgentMessage;
    }
  },

  buildTransitionOutputFormat: buildTransitionOutputFormatForClaude,
};
