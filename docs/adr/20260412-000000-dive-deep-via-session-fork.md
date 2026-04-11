# Dive Deep via Session Fork

**Date:** 2026-04-12
**Status:** accepted

## Context

The planning assistant generates proposals (workflow-runs) during a chat session. Some proposals are too broad or need further exploration before the user commits to running them. Users needed a way to branch into a focused conversation about a specific proposal without losing the context that led to it.

The key challenge was preserving the full conversation transcript in the child chat so the agent understands the prior discussion without replaying or summarizing it.

## Decision

Use the Claude Agent SDK's `forkSession()` to create a child chat that inherits the full conversation transcript from its parent. When the user clicks "Dive Deep" on a pending proposal, the backend forks the Claude session, creates a new `Chat` record linked to the forked session, and sends a seeding message that focuses the agent on the selected proposal.

Specifically:

- A `parent_chat_id` column on the `chats` table links child chats to their origin for UI breadcrumbs and lineage tracking.
- The API endpoint `POST /api/chats/{id}/proposals/{proposalId}/dive-deep` orchestrates the fork, chat creation, and seeding message.
- `fork()` is an optional method on the `AgentRuntime` interface. The Claude SDK runtime implements it via `forkSession()`; the Codex runtime throws `ServiceUnavailableError`.
- The forked chat resumes via the existing `resume()` path since it already has a `claude_session_id`, requiring no changes to `ChatAgent.runAgent()`.

## Consequences

- Users can explore, refine, or decompose proposals in a context-aware child chat without polluting the parent conversation.
- The forked session is a full copy of the transcript — no summarization loss or replay latency.
- Dive deep is Claude-only. Codex-backed chats cannot fork; the service rejects the request at runtime. The UI button appears regardless of provider, surfacing the error if attempted on a Codex chat.
- Each fork creates a separate Claude session, consuming additional session storage on Anthropic's side.

## Alternatives considered

- **Summary-based context transfer**: Start a new chat with a system prompt summarizing the parent conversation. Avoids SDK dependency but loses nuance and prior tool outputs. Rejected because `forkSession()` provides lossless context transfer with minimal implementation effort.
- **In-place proposal refinement**: Add a refinement flow within the same chat rather than branching. Simpler but clutters the parent chat and makes it harder to track which proposals came from the original conversation vs. refinement.
