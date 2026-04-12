import { forkSession, query } from "@anthropic-ai/claude-agent-sdk";
import {
  buildTransitionOutputFormatForClaude,
  CLAUDE_SDK_TOOLS,
} from "@/backend/domain/agent/claude-common";
import { createClaudeAitmMcpConfig } from "@/backend/mcp/runtime-config";
import { toClaudePermissionMode } from "./permission-mode";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentResumeParams,
  AgentRuntime,
  ForkSessionParams,
  ForkSessionResult,
} from "./runtime";

export class ClaudeSDK implements AgentRuntime {
  async *query({
    prompt,
    cwd,
    permissionMode,
    abortController,
    outputFormat,
    tools,
  }: AgentQueryParams): AsyncIterable<AgentMessage> {
    const { mcpServers, close } = await createClaudeAitmMcpConfig();
    const result = query({
      prompt,
      options: {
        cwd,
        permissionMode: toClaudePermissionMode(permissionMode),
        abortController,
        outputFormat,
        tools: tools ?? CLAUDE_SDK_TOOLS,
        mcpServers,
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
      },
    });

    try {
      for await (const message of result) {
        yield message as unknown as AgentMessage;
      }
    } finally {
      await close();
    }
  }

  async *resume({
    agentSessionId,
    prompt,
    cwd,
    permissionMode,
    abortController,
    outputFormat,
    tools,
  }: AgentResumeParams): AsyncIterable<AgentMessage> {
    const { mcpServers, close } = await createClaudeAitmMcpConfig();
    const result = query({
      prompt,
      options: {
        cwd,
        permissionMode: toClaudePermissionMode(permissionMode),
        abortController,
        outputFormat,
        resume: agentSessionId,
        tools: tools ?? CLAUDE_SDK_TOOLS,
        mcpServers,
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });

    try {
      for await (const message of result) {
        yield message as unknown as AgentMessage;
      }
    } finally {
      await close();
    }
  }

  async fork(
    sessionId: string,
    options?: ForkSessionParams,
  ): Promise<ForkSessionResult> {
    const result = await forkSession(sessionId, {
      dir: options?.dir,
      title: options?.title,
    });
    return { sessionId: result.sessionId };
  }

  buildTransitionOutputFormat = buildTransitionOutputFormatForClaude;
}
