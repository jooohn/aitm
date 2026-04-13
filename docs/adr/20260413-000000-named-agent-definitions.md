# Named agent definitions with alias references

**Date:** 2026-04-13
**Status:** accepted

## Context

Agent configuration was repeated inline at the top level (`agent` object) and optionally overridden per workflow step with partial `agent` blocks that used shallow inheritance. When multiple steps shared the same agent setup (e.g. "codex with gpt-5.4" or "claude with full permissions"), the config was duplicated. The merge-based resolution logic in `resolveAgentConfig` added complexity.

## Decision

Replace the single top-level `agent` object with a named `agents` map and a `default-agent` string alias:

- **`agents`** — a `Record<string, AgentConfig>` where each entry is a fully-specified agent profile (`provider` required).
- **`default-agent`** — a string alias referencing a key in `agents`, used when a step does not specify one.
- **Step-level `agent`** — changed from an inline partial override object to a string alias referencing a key in `agents`.
- **No backward compatibility shim** — if the old top-level `agent` object is present, validation produces a clear migration error.

Agent resolution simplifies from merge-based inheritance to a direct map lookup.

## Consequences

- Breaking config change: users must migrate from `agent: { provider, model, ... }` to `agents` map + `default-agent`.
- Config validation detects the old format and provides a migration message.
- No database changes — `AgentConfig` shape is unchanged; only how it's sourced from YAML differs.
- `AgentWorkflowStepDto.agent` in the API changes from `Partial<AgentConfigDto>` to `string | undefined`.
- Step-level inline overrides (e.g. changing only `model` for one step) require defining a separate named profile. This trades convenience for explicitness.

## Alternatives considered

- **Keep inline overrides with shallow inheritance** — rejected because it encourages duplication and the merge logic is error-prone.
- **Support both inline objects and string aliases at the step level** — rejected to keep the config schema simple and unambiguous.
