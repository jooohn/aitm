import type {
  CanUseTool,
  OutputFormat,
  PermissionMode,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeQueryParams {
  sessionId: string;
  prompt: string;
  cwd: string;
  permissionMode: PermissionMode;
  abortController: AbortController;
  canUseTool: CanUseTool;
  outputFormat?: OutputFormat;
}

export interface ClaudeStub {
  query(params: ClaudeQueryParams): AsyncIterable<SDKMessage>;
}
