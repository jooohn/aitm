# Spec: Session Management

**Status:** implemented
**Last updated:** 2026-03-29

## Summary

A session is a cohesive, purpose-bound unit of coding-agent work attached to a specific worktree. It encapsulates a goal, tracks execution state, captures agent output, and mediates interaction between the user and the running agent. Sessions are created exclusively by the workflow engine — not directly by the user.

## Background

Each session runs a Claude Code agent via the **Claude Code SDK** inside a worktree directory. The agent pursues the goal described at session creation and emits a structured transition decision (JSON) as its final output. Users can observe the agent's output stream in real time and exchange messages with it when the agent requires clarification.

## Data model

Sessions are persisted in SQLite.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `repository_path` | string | no | Absolute path to the repository |
| `worktree_branch` | string | no | The worktree branch in which the agent runs |
| `goal` | string | no | Free-text description of what the agent should accomplish (may include handoff context from prior states) |
| `transitions` | string (JSON) | no | Serialised `WorkflowTransition[]` — the set of transitions Claude evaluates at session end |
| `transition_decision` | string (JSON) | yes | Serialised `TransitionDecision` emitted by Claude: `{transition, reason, handoff_summary}` |
| `status` | enum | no | `RUNNING` \| `WAITING_FOR_INPUT` \| `SUCCEEDED` \| `FAILED` |
| `terminal_attach_command` | string | yes | Shell command to attach to the live agent (e.g. `claude --resume <claude-session-id>`) |
| `log_file_path` | string | no | Absolute path to the append-only stdout/stderr log file (e.g. `~/.aitm/sessions/<id>.log`) |
| `claude_session_id` | string | yes | The internal Claude session ID, set once the agent starts |
| `created_at` | timestamp | no | When the session was created |
| `updated_at` | timestamp | no | Last status change |

### Message thread

Each session has an ordered message thread stored in a `session_messages` table.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `session_id` | string (FK → sessions) | no | Owning session |
| `role` | enum | no | `agent` \| `user` |
| `content` | string | no | Message text |
| `created_at` | timestamp | no | When the message was created |

## Session lifecycle

```
            ┌──────────────┐
   create   │              │
  ─────────▶│   RUNNING    │◀──────────────────┐
            │              │                   │
            └──────┬───────┘                   │
                   │                           │
      agent needs  │                 user sends │ input
          input    │                           │
                   ▼                           │
            ┌──────────────┐                   │
            │   WAITING_   │───────────────────┘
            │   FOR_INPUT  │
            └──────┬───────┘
                   │
           (also reachable from RUNNING)
                   │
         ┌─────────┴──────────┐
         │                    │
         ▼                    ▼
   ┌───────────┐        ┌──────────┐
   │ SUCCEEDED │        │  FAILED  │
   └───────────┘        └──────────┘
```

### State transitions

| From | To | Trigger |
|---|---|---|
| _(none)_ | `RUNNING` | Session created; agent process started |
| `RUNNING` | `WAITING_FOR_INPUT` | Agent emits an input-request message |
| `WAITING_FOR_INPUT` | `RUNNING` | User sends a message in reply |
| `RUNNING` | `SUCCEEDED` | Agent emits a valid `transition_decision` |
| `WAITING_FOR_INPUT` | `SUCCEEDED` | Agent emits a valid `transition_decision` after receiving input |
| `RUNNING` | `FAILED` | User explicitly marks the session as failed; or agent exits without valid output |
| `WAITING_FOR_INPUT` | `FAILED` | User explicitly marks the session as failed |

`SUCCEEDED` and `FAILED` are terminal states. No transitions out of them.

## Operations

### Create session

Sessions are created internally by the workflow engine, not directly by users.

- Accepts: `repository_path`, `worktree_branch`, `goal`, `transitions`, and an optional `onComplete` callback.
- Persists the session record with `status: RUNNING`.
- Spawns the Claude Code agent in the worktree directory.
- Stores `terminal_attach_command` and `claude_session_id` once the agent initialises.
- Calls `onComplete(decision)` when the agent finishes, where `decision` is the structured output or `null` on failure.

### Get session

- Returns the session record including current status, goal, transitions, transition decision, and terminal attach command.

### List sessions

- Returns all sessions, optionally filtered by `repository_path`, `worktree_branch`, or `status`.
- Ordered by `created_at` descending.

### Mark session as failed

- Accepts a session ID.
- Allowed from `RUNNING` or `WAITING_FOR_INPUT` only.
- Terminates the agent process.
- Sets `status: FAILED`.

### Send message

- Accepts a session ID and message content from the user.
- Allowed when `status` is `WAITING_FOR_INPUT`.
- Persists the message with `role: user`.
- Forwards the message to the running agent process.
- Transitions status to `RUNNING`.

### Stream output

- Provides a real-time stream of the agent's stdout/stderr for a given session.
- Delivered over SSE.
- Historical output since session start is replayed on connection so the UI can render the full buffer.

## API surface

| Method | Path | Operation |
|---|---|---|
| `GET` | `/api/sessions` | List |
| `GET` | `/api/sessions/:id` | Get |
| `POST` | `/api/sessions/:id/fail` | Mark as failed |
| `POST` | `/api/sessions/:id/messages` | Send user message |
| `GET` | `/api/sessions/:id/stream` | Stream agent output (SSE) |
| `GET` | `/api/sessions/:id/messages` | List message thread |

## UI

### Session list

- Accessible from the worktree detail page (`/repositories/:organization/:name/worktrees/:branch`).
- Shows all sessions for the worktree with status badges, goal summary, and timestamps.
- Sessions are created by workflow runs, not directly from this page.

### Session detail page (`/sessions/:id`)

- **Output pane** — live terminal output stream rendered in a scrollable, monospace block. Replays history on load.
- **Terminal attach** — a copyable code snippet showing `terminal_attach_command` so the user can attach from their terminal.
- **Message thread** — ordered chat-like list of `agent` and `user` messages below the output pane.
- **Input box** — visible and enabled when `status` is `WAITING_FOR_INPUT`. Submits a user message.
- **Status indicator** — shows current status; includes a "Mark as failed" button when the session is not in a terminal state.

## Out of scope

- Direct session creation from the UI (sessions are only started via workflow runs).
- Pausing and resuming sessions.
- Automated failure detection (e.g. exit codes, timeouts) — failure is user-initiated for now.
- Multi-worktree sessions or sessions that span repositories.
- Session re-runs or retries from the UI.

## Decisions

### Process management
Server restarts mark any `RUNNING` or `WAITING_FOR_INPUT` session as `FAILED`. On startup, aitm scans for non-terminal sessions and transitions them to `FAILED`.

### Output storage
Agent stdout/stderr is written to an append-only log file at `~/.aitm/sessions/<id>.log`. The path is stored in `log_file_path`. The stream endpoint tails this file and replays it from the beginning on each new connection.

### Structured output
Sessions always use the Agent SDK's `outputFormat` with a `json_schema` type. Claude's final output is constrained to `{transition, reason, handoff_summary}`. This output is stored in `transition_decision` and consumed by the workflow engine.

### Agent execution
Sessions use the **Claude Code SDK** (not the CLI). The SDK runs in-process within the aitm server.
