import { describe, expect, it } from "vitest";
import {
  type PermissionMode,
  toClaudePermissionMode,
  toCodexConfig,
} from "./permission-mode";

describe("toClaudePermissionMode", () => {
  it("maps plan to plan", () => {
    expect(toClaudePermissionMode("plan")).toBe("plan");
  });

  it("maps edit to acceptEdits", () => {
    expect(toClaudePermissionMode("edit")).toBe("acceptEdits");
  });

  it("maps full to bypassPermissions", () => {
    expect(toClaudePermissionMode("full")).toBe("bypassPermissions");
  });
});

describe("toCodexConfig", () => {
  it("maps plan to read-only sandbox, no network, never approval", () => {
    expect(toCodexConfig("plan")).toEqual({
      sandboxMode: "read-only",
      networkAccessEnabled: false,
      approvalPolicy: "never",
    });
  });

  it("maps edit to workspace-write sandbox, no network, never approval", () => {
    expect(toCodexConfig("edit")).toEqual({
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      approvalPolicy: "never",
    });
  });

  it("maps full to danger-full-access sandbox, network enabled, never approval", () => {
    expect(toCodexConfig("full")).toEqual({
      sandboxMode: "danger-full-access",
      networkAccessEnabled: true,
      approvalPolicy: "never",
    });
  });
});

describe("PermissionMode type", () => {
  it("accepts valid permission modes", () => {
    const modes: PermissionMode[] = ["plan", "edit", "full"];
    expect(modes).toHaveLength(3);
  });
});
