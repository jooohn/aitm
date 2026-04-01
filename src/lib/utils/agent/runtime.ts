import type {
  CanUseTool,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { WorkflowTransition } from "@/lib/infra/config";

type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input?: unknown };

export type AgentMessage =
  | {
      type: "system";
      subtype: "init";
      session_id?: string;
      attach_command?: string;
    }
  | {
      type: "event";
      event_type: string;
      message?: string;
      detail?: unknown;
    }
  | {
      type: "assistant";
      message: { content?: AssistantContentBlock[] };
    }
  | {
      type: "result";
      subtype: "success" | "error" | "cancelled";
      result?: string;
      structured_output?: unknown;
    };

export interface AgentQueryParams {
  sessionId: string;
  prompt: string;
  cwd: string;
  command?: string;
  model?: string;
  permissionMode: PermissionMode;
  abortController: AbortController;
  canUseTool: CanUseTool;
  outputFormat?: OutputFormat;
}

export interface OutputFormat {
  type: "json_schema";
  schema: Record<string, unknown>;
}

export interface AgentRuntime {
  query(params: AgentQueryParams): AsyncIterable<AgentMessage>;

  buildTransitionOutputFormat(transitions: WorkflowTransition[]): OutputFormat;
}
