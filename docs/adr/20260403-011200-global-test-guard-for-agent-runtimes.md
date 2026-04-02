# Global test guard for agent runtimes

**Date:** 2026-04-03
**Status:** accepted

## Context

Tests that create workflow runs or sessions indirectly trigger `agentService.startAgent()`, which is fire-and-forget. In the test environment no real AI agent is available, so the background agent process fails and calls its completion callback with `null`. This races with test assertions: sometimes the callback fires before the test checks state, flipping the workflow run to "failure" and causing flaky failures in CI.

Individual tests can mock `agentService.startAgent`, but there is no mechanism to prevent a new or modified test from accidentally invoking a real agent runtime (claude CLI, claude SDK, or codex SDK). A forgotten mock would either produce flaky tests or, worse, attempt to spawn a real AI process in CI.

## Decision

Prevent real agent runtimes from being invoked in tests using two layers of defence:

1. **Global vitest setup file (`src/test-setup.ts`)** registered via `setupFiles` in `vitest.config.ts`. It uses `vi.mock()` to replace the three agent runtime wrapper modules (`claude-cli`, `claude-sdk`, `codex-sdk`) with stubs that throw a descriptive error if their `query` or `resume` methods are called. This is the safety net — even if a test forgets to mock `agentService.startAgent`, no real process can spawn.

2. **Per-test `agentService.startAgent` mocks** in every test file that creates workflow runs or sessions. These prevent the `AgentService` from reaching the runtime layer at all, keeping the tests deterministic and fast.

Tests that directly exercise a runtime wrapper (e.g. `codex-sdk.test.ts`) opt out of the global mock with `vi.unmock()` and provide their own mock of the underlying external package.

## Consequences

- New tests that call `createWorkflowRun()` or `createSession()` without mocking `agentService.startAgent` will get a clear error from the global guard rather than flaky failures or real process spawns.
- Tests that unit-test a runtime wrapper must add `vi.unmock()` for that specific module.
- The global setup adds a small amount of overhead per test file (vitest processes the setup before each file), but this is negligible compared to overall test runtime.

## Alternatives considered

- **Mock `node:child_process.spawn` globally** — too broad; many tests legitimately use `spawn` for git operations and the command state executor.
- **Mock `AgentService.prototype` methods globally** — too high-level; it would neuter the `AgentService` unit tests that need the real `startAgent` logic with mocked runtimes.
- **Mock only the external packages (`@openai/codex-sdk`, `@anthropic-ai/claude-agent-sdk`)** — works but doesn't guard `claude-cli.ts` which uses `node:child_process.spawn` directly, and is harder to reason about since the mock is one layer removed from the code under test.
