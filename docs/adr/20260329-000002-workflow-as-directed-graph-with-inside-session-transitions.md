# Workflow as a directed graph with inside-session transition evaluation

**Date:** 2026-03-29
**Status:** accepted

## Context

Workflows in aitm need to express complex task flows — including cycles (e.g. test fails → go back to implement) and branching (e.g. plan needs clarification vs. plan is ready). The workflow engine also needs a mechanism to decide which transition to take after a session ends.

## Decision

Model a workflow as a directed graph where each node (state) has an ordered list of outgoing transitions. Each transition specifies a `when` condition in natural language and either a target state or a terminal outcome (`success` / `failure`). Transition evaluation happens **inside the session**: Claude evaluates the `when` conditions and emits a structured decision as its final output using the Agent SDK's `outputFormat` constraint.

## Consequences

- Cycles are expressible naturally (a state can transition back to itself or a prior state).
- The `when` condition is natural language evaluated by Claude, so it is flexible but not mechanically verifiable — the correctness of transitions depends on prompt quality.
- Embedding transition evaluation in the session means aitm receives a single structured output and does not need a separate re-prompt round-trip to determine the next state.
- The Agent SDK's `outputFormat` guarantees the transition decision is valid JSON; aitm never needs to parse or validate it manually.

## Alternatives considered

- **Sequential pipeline** (fixed ordered list of steps) — simpler to configure, but cannot express cycles or conditional branching (e.g. test failure → re-implement).
- **Outside-session transition evaluation** (aitm re-prompts Claude after the session ends with the transition list) — cleaner separation of concerns, but adds an extra API call and requires maintaining session context across two calls.
- **Exit-code or file-based transitions** (shell command decides next state) — deterministic and inspectable, but loses the natural-language flexibility that makes Claude-driven workflows valuable.
