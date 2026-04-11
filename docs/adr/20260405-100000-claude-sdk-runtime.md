# ADR: Switch from Claude CLI to Claude SDK Runtime

**Status:** accepted
**Date:** 2026-04-05

## Context

aitm originally launched Claude Code sessions by spawning the `claude` CLI as a child process with flags like `--print`, `--output-format stream-json`, and `--permission-mode`. While functional, this approach had limitations:

- Parsing streaming JSON from stdout was fragile and required custom parsing logic.
- Structured output relied on `--json-schema` flag parsing rather than native SDK support.
- Session resume required re-spawning the CLI with `--resume <id>`, which was slower and less reliable.
- Tool allowlists and permission modes were limited to what the CLI exposed as flags.
- Error handling was based on exit codes and stderr parsing rather than typed exceptions.

The Anthropic team released the `@anthropic-ai/claude-agent-sdk` package, providing a programmatic API for the same capabilities.

## Decision

Replace the Claude CLI runtime with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) as the primary agent runtime. The CLI runtime is retained but is no longer the default.

The SDK runtime uses `query()` for initial sessions and `resume()` with the stored `claude_session_id` for session continuation. It provides native support for:

- `outputFormat` with JSON schema validation for structured transition decisions
- Tool allowlists via a typed tools array
- Permission modes mapped from aitm's `plan`/`edit`/`full` to SDK equivalents (`plan`, `acceptEdits`, `bypassPermissions`)
- System prompt presets (e.g. `claude_code`)
- Streaming via `AsyncIterable<AgentMessage>`

## Consequences

- **Simpler code**: No child process management, stdout parsing, or CLI flag construction for the primary runtime.
- **Better structured output**: SDK guarantees the output schema; no manual JSON parsing or failure-on-malformed-JSON.
- **Reliable resume**: `resume()` is a first-class SDK operation rather than a CLI re-spawn.
- **Runtime selection**: `AgentRuntime` interface abstracts over Claude SDK and Codex SDK; the CLI implementation remains available but is not the default path.
- **Dependency**: Adds `@anthropic-ai/claude-agent-sdk` as a direct dependency.
