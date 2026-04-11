# ADR: Add Codex SDK as a Secondary Agent Runtime

**Date:** 2026-04-11
**Status:** accepted

## Context

aitm's primary agent runtime is the Claude Agent SDK
(see ADR `20260405-100000-claude-sdk-runtime.md`). That ADR introduced the
`AgentRuntime` interface and noted that the abstraction was designed to
accommodate alternate runtimes, but it did not formalize Codex SDK support.

Users have two practical reasons to want a second runtime:

- Access to different frontier models (OpenAI's Codex-style models) for
  specific steps where they perform better — e.g. planning vs. implementation.
- Resilience against outages or rate limits on a single provider.

The Codex SDK (`@openai/codex-sdk`) exposes a comparable programmatic API:
thread-based sessions, streamed events, model and permission-mode selection,
and structured output. The shape is close enough to the Claude SDK that a
single `AgentRuntime` interface can serve both.

## Decision

Support Codex SDK as a first-class alternate agent runtime alongside Claude
SDK.

- Runtime selection is driven by `agent.provider` in `~/.aitm/config.yaml`,
  with values `claude` (default) or `codex`. Step-level `agent` overrides can
  switch providers per step.
- Implementation lives in `src/backend/domain/agent/codex-sdk.ts`, conforming
  to the same `AgentRuntime` interface as `claude-sdk.ts`.
- Permission modes map from aitm's `plan` / `edit` / `full` to the Codex
  SDK's equivalents.
- Structured transition decisions are emitted via a Codex-specific output
  format builder (`buildTransitionOutputFormatForCodex`), preserving the
  same `{ transition, reason, handoff_summary, clarifying_question }`
  contract as the Claude runtime.
- Credentials follow the Codex SDK's own conventions (CLI auth / env var);
  aitm does not manage them.

## Consequences

- Workflows can mix providers: e.g. use Codex for `plan` and Claude for
  `implement` via step-level overrides.
- The `AgentRuntime` interface becomes a load-bearing abstraction — any
  future runtime must implement `query()`, `resume()`, permission-mode
  mapping, and structured output. Regressions are guarded by per-runtime
  unit tests (`claude-sdk.test.ts`, `codex-sdk.test.ts`).
- Adds `@openai/codex-sdk` as a direct dependency.
- Users who never select Codex pay only the dependency cost; no runtime
  code path changes for Claude-only users.

## Alternatives considered

- **Claude-only.** Simpler, but forgoes cross-provider flexibility and
  leaves users exposed to single-provider outages.
- **Shell out to the `codex` CLI** (mirroring the old Claude CLI runtime).
  Rejected for the same reasons the Claude runtime was moved off the CLI:
  fragile stdout parsing, weaker structured output, slower resume.
- **Plugin-style runtimes loaded from config.** Overkill for two runtimes;
  can be revisited if a third provider is added.
