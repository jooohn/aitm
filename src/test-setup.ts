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
import { beforeEach, vi } from "vitest";
import { resetConfigForTests } from "@/backend/infra/config";

function throwGuard(runtime: string): () => never {
  return () => {
    throw new Error(
      `test-setup: ${runtime} runtime invoked. ` +
        "Mock agentService.startAgent or vi.unmock() the runtime in your test.",
    );
  };
}

beforeEach(() => {
  delete process.env.AITM_CONFIG_PATH;
  resetConfigForTests();
});

vi.mock("@/backend/domain/agent/claude-sdk", () => ({
  ClaudeSDK: class {
    query = vi.fn(throwGuard("claude-sdk"));
    resume = vi.fn(throwGuard("claude-sdk"));
    buildTransitionOutputFormat = vi.fn(() => ({
      type: "json_schema",
      schema: {},
    }));
  },
}));

vi.mock("@/backend/domain/agent/codex-sdk", () => ({
  CodexSDK: class {
    query = vi.fn(throwGuard("codex-sdk"));
    resume = vi.fn(throwGuard("codex-sdk"));
    buildTransitionOutputFormat = vi.fn(() => ({
      type: "json_schema",
      schema: {},
    }));
  },
}));
