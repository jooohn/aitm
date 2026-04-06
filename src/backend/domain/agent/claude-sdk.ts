import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  buildTransitionOutputFormatForClaude,
  CLAUDE_SDK_TOOLS,
} from "@/backend/domain/agent/claude-common";
import { toClaudePermissionMode } from "./permission-mode";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentResumeParams,
  AgentRuntime,
} from "./runtime";

export class ClaudeSDK implements AgentRuntime {
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
        tools: CLAUDE_SDK_TOOLS,
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });

    for await (const message of result) {
      yield message as unknown as AgentMessage;
    }
  }

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
        tools: CLAUDE_SDK_TOOLS,
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });

    for await (const message of result) {
      yield message as unknown as AgentMessage;
    }
  }

  buildTransitionOutputFormat = buildTransitionOutputFormatForClaude;
}
