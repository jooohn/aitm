/**
 * Global test setup: prevent real AI agent processes from being spawned.
 *
 * Mocks the agent runtime wrapper modules so that even if a test forgets to
 * mock agentService.startAgent, no real claude/codex process will spawn.
 *
 * Tests that directly exercise a runtime wrapper (e.g. codex-sdk.test.ts)
 * should call vi.unmock() for that module — their own vi.mock() of the
 * underlying package will then take effect on the real wrapper code.
 */
import { vi } from "vitest";

function throwGuard(runtime: string): () => never {
  return () => {
    throw new Error(
      `test-setup: ${runtime} runtime invoked. ` +
        "Mock agentService.startAgent or vi.unmock() the runtime in your test.",
    );
  };
}

vi.mock("@/backend/domain/agent/claude-cli", () => ({
  claudeCLI: {
    query: vi.fn(throwGuard("claude-cli")),
    resume: vi.fn(throwGuard("claude-cli")),
    buildTransitionOutputFormat: vi.fn(() => ({
      type: "json_schema",
      schema: {},
    })),
  },
}));

vi.mock("@/backend/domain/agent/claude-sdk", () => ({
  claudeSDK: {
    query: vi.fn(throwGuard("claude-sdk")),
    resume: vi.fn(throwGuard("claude-sdk")),
    buildTransitionOutputFormat: vi.fn(() => ({
      type: "json_schema",
      schema: {},
    })),
  },
}));

vi.mock("@/backend/domain/agent/codex-sdk", () => ({
  codexSDK: {
    query: vi.fn(throwGuard("codex-sdk")),
    resume: vi.fn(throwGuard("codex-sdk")),
    buildTransitionOutputFormat: vi.fn(() => ({
      type: "json_schema",
      schema: {},
    })),
  },
}));
