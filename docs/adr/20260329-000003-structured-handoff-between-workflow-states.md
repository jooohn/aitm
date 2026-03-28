# Structured handoff between workflow states

**Date:** 2026-03-29
**Status:** accepted

## Context

When a workflow transitions from one state to the next, the incoming session needs some awareness of what the previous session did. The key constraint is context window size: one of the primary reasons for splitting work into multiple states is to avoid building up a large context that degrades LLM performance and increases cost.

## Decision

Use a **structured handoff**: when a session ends, Claude produces a brief summary of what was accomplished (key decisions, artifacts produced) as part of its structured final output. The next session receives this summary plus the file path to the previous session's log, prepended to its goal. The log is not loaded automatically — the next session can read it if deeper context is needed.

## Consequences

- Each session starts with a small, focused context (goal + summary), keeping token usage low.
- The log file reference gives the next session an escape hatch to retrieve full detail without forcing it to load everything.
- The summary quality depends on Claude's output at the end of the previous session; a low-quality summary may lose important context. The `outputFormat` schema constraint ensures the field is always present, but not that its content is useful.

## Alternatives considered

- **No handoff (Option A)** — each session starts with only its goal; shared context lives implicitly in the worktree filesystem. Simple and predictable, but loses any context that isn't expressed as a file on disk (e.g. decisions made, approaches rejected).
- **Full conversation history inheritance (Option C)** — the new session receives the entire message history of the previous session. Maximum continuity, but defeats the purpose of splitting work into states: context grows unboundedly across the workflow run.
