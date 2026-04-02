import type { PermissionMode as ClaudePermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalMode, SandboxMode } from "@openai/codex-sdk";

export type PermissionMode = "plan" | "edit" | "full";

export const DEFAULT_PERMISSION_MODE: PermissionMode = "edit";

export function toClaudePermissionMode(
  mode: PermissionMode,
): ClaudePermissionMode {
  switch (mode) {
    case "plan":
      return "plan";
    case "edit":
      return "acceptEdits";
    case "full":
      return "bypassPermissions";
  }
}

export interface CodexPermissionConfig {
  sandboxMode: SandboxMode;
  networkAccessEnabled: boolean;
  approvalPolicy: ApprovalMode;
}

export function toCodexConfig(mode: PermissionMode): CodexPermissionConfig {
  switch (mode) {
    case "plan":
      return {
        sandboxMode: "read-only",
        networkAccessEnabled: false,
        approvalPolicy: "never",
      };
    case "edit":
      return {
        sandboxMode: "workspace-write",
        networkAccessEnabled: false,
        approvalPolicy: "never",
      };
    case "full":
      return {
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        approvalPolicy: "never",
      };
  }
}
