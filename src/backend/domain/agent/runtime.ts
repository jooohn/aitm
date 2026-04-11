import type {
  OutputMetadataFieldDef,
  WorkflowTransition,
} from "@/backend/infra/config";
import type { PermissionMode } from "./permission-mode";

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

export type SessionTransition = WorkflowTransition;

export interface AgentQueryParams {
  sessionId: string;
  prompt: string;
  cwd: string;
  command?: string;
  model?: string;
  permissionMode: PermissionMode;
  abortController: AbortController;
  outputFormat?: OutputFormat;
  tools?: string[];
}

export interface AgentResumeParams {
  sessionId: string;
  agentSessionId: string;
  prompt: string;
  cwd: string;
  command?: string;
  model?: string;
  permissionMode: PermissionMode;
  abortController: AbortController;
  outputFormat?: OutputFormat;
  tools?: string[];
}

export interface OutputFormat {
  type: "json_schema";
  schema: Record<string, unknown>;
}

export interface ForkSessionParams {
  dir?: string;
  title?: string;
}

export interface ForkSessionResult {
  sessionId: string;
}

export interface AgentRuntime {
  query(params: AgentQueryParams): AsyncIterable<AgentMessage>;

  resume(params: AgentResumeParams): AsyncIterable<AgentMessage>;

  fork?(
    sessionId: string,
    options?: ForkSessionParams,
  ): Promise<ForkSessionResult>;

  buildTransitionOutputFormat(
    transitions: SessionTransition[],
    metadataFields?: Record<string, OutputMetadataFieldDef>,
  ): OutputFormat;
}
