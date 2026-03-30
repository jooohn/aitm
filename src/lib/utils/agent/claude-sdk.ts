import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeQueryParams, ClaudeStub } from "./claude-stub";

export const claudeSDK: ClaudeStub = {
  query({
    prompt,
    cwd,
    permissionMode,
    abortController,
    canUseTool,
    outputFormat,
  }) {
    return query({
      prompt,
      options: {
        cwd,
        permissionMode,
        abortController,
        canUseTool,
        outputFormat,
      },
    });
  },
};
