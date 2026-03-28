# Spec: Session Management

**Status:** draft
**Last updated:** 2026-03-28

## Summary

A session is a cohesive, purpose-bound unit of coding-agent work attached to a specific worktree. It encapsulates a goal, tracks execution state, captures agent output, and mediates interaction between the user and the running agent. Sessions are the primary top-level resource users create and monitor in aitm.

## Background

Each session runs a Claude Code agent via the **Claude Code SDK** inside a worktree directory. The agent pursues the goal described at session creation and self-evaluates against a completion condition to decide when it is done. Users can observe the agent's output stream in real time and exchange messages with it when the agent requires clarification.

## Data model

Sessions are persisted in SQLite.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `repository_id` | string (FK → repositories) | no | The repository this session runs against |
| `worktree_branch` | string (FK → worktrees.branch) | no | The worktree in which the agent runs |
| `goal` | string | no | Free-text description of what the agent should accomplish |
| `completion_condition` | string | no | Condition the agent evaluates to decide it is done (e.g. "implementation plan has been written and reviewed by user") |
| `status` | enum | no | `RUNNING` \| `WAITING_FOR_INPUT` \| `SUCCEEDED` \| `FAILED` |
| `created_at` | timestamp | no | When the session was created |
| `updated_at` | timestamp | no | Last status change |
| `terminal_attach_command` | string | yes | Shell command the user can run to attach to the live agent process (e.g. `claude --resume <session-id>`) |
| `log_file_path` | string | no | Absolute path to the append-only stdout/stderr log file for this session (e.g. `~/.aitm/sessions/<id>.log`) |

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
| `RUNNING` | `SUCCEEDED` | Agent self-evaluates completion condition as met |
| `WAITING_FOR_INPUT` | `SUCCEEDED` | Agent self-evaluates completion condition as met after receiving input |
| `RUNNING` | `FAILED` | User explicitly marks the session as failed |
| `WAITING_FOR_INPUT` | `FAILED` | User explicitly marks the session as failed |

`SUCCEEDED` and `FAILED` are terminal states. No transitions out of them.

## Operations

### Create session

- Accepts: `repository_id`, `worktree_branch`, `goal`, `completion_condition`.
- Validates that the referenced repository and worktree exist.
- Persists the session record with `status: RUNNING`.
- Spawns the Claude Code agent process in the worktree directory, passing `goal` and `completion_condition` as context.
- Stores the terminal attach command (e.g. `claude --resume <session-id>`) in `terminal_attach_command`.
- Returns the created session record.

### Get session

- Returns the session record including current status, goal, completion condition, and terminal attach command.

### List sessions

- Returns all sessions, optionally filtered by `repository_id`, `worktree_branch`, or `status`.
- Ordered by `created_at` descending.

### Mark session as failed

- Accepts a session ID.
- Allowed from `RUNNING` or `WAITING_FOR_INPUT` only.
- Terminates the agent process.
- Sets `status: FAILED`.

### Send message

- Accepts a session ID and message content from the user.
- Allowed when `status` is `RUNNING` or `WAITING_FOR_INPUT`.
- Persists the message with `role: user`.
- Forwards the message to the running agent process.
- If the session was `WAITING_FOR_INPUT`, transitions to `RUNNING`.

### Stream output

- Provides a real-time stream of the agent's stdout/stderr for a given session.
- Delivered over SSE or WebSocket.
- Historical output since session start is replayed on connection so the UI can render the full terminal buffer.

## API surface

| Method | Path | Operation |
|---|---|---|
| `POST` | `/api/sessions` | Create |
| `GET` | `/api/sessions` | List |
| `GET` | `/api/sessions/:id` | Get |
| `POST` | `/api/sessions/:id/fail` | Mark as failed |
| `POST` | `/api/sessions/:id/messages` | Send user message |
| `GET` | `/api/sessions/:id/stream` | Stream agent output (SSE) |
| `GET` | `/api/sessions/:id/messages` | List message thread |

### POST /api/sessions — request body

```json
{
  "repository_id": "uuid",
  "worktree_branch": "feat/my-feature",
  "goal": "Write an implementation plan for feature A",
  "completion_condition": "Implementation plan document has been written and the user has reviewed it"
}
```

### GET /api/sessions/:id — response shape

```json
{
  "id": "uuid",
  "repository_id": "uuid",
  "worktree_branch": "feat/my-feature",
  "goal": "Write an implementation plan for feature A",
  "completion_condition": "Implementation plan document has been written and the user has reviewed it",
  "status": "WAITING_FOR_INPUT",
  "terminal_attach_command": "claude --resume abc123",
  "created_at": "2026-03-28T10:00:00Z",
  "updated_at": "2026-03-28T10:05:00Z"
}
```

## UI

### Session list

- Accessible from the worktree detail page (`/repositories/:organization/:name/worktrees/:branch`).
- Shows all sessions for the worktree with status badges, goal summary, and timestamps.
- "New session" button opens a creation form.

### Session creation form

- Fields: goal (textarea), completion condition (textarea).
- Repository and worktree are inferred from the page context.

### Session detail page (`/sessions/:id`)

- **Output pane** — live terminal output stream rendered in a scrollable, monospace block. Replays history on load.
- **Terminal attach** — a copyable code snippet showing `terminal_attach_command` so the user can attach from their terminal.
- **Message thread** — ordered chat-like list of `agent` and `user` messages below the output pane.
- **Input box** — visible and enabled when `status` is `RUNNING` or `WAITING_FOR_INPUT`. Submits a user message.
- **Status indicator** — shows current status; includes a "Mark as failed" button when the session is not in a terminal state.

## Out of scope

- Pausing and resuming sessions.
- Pre-defined session types or templates (completion conditions come from the caller, not the system).
- Automated failure detection (e.g. exit codes, timeouts) — failure is user-initiated for now.
- Multi-worktree sessions or sessions that span repositories.
- Branching or forking a session.
- Session re-runs or retries from the UI.

## Decisions

### Process management
Server restarts mark any `RUNNING` or `WAITING_FOR_INPUT` session as `FAILED`. On startup, aitm scans for non-terminal sessions and transitions them to `FAILED`. No external process supervisor is used.

### Output storage
Agent stdout/stderr is written to an append-only log file at `~/.aitm/sessions/<id>.log`. The path is stored in `log_file_path`. The stream endpoint tails this file and replays it from the beginning on each new connection. No agent output is stored in the DB.

### Agent execution & signaling
Sessions use the **Claude Code SDK** (not the CLI). The SDK runs in-process within the aitm server, giving programmatic access to conversation state. This enables:
- Detecting when the agent emits an input request → transition to `WAITING_FOR_INPUT`
- Detecting when the agent halts after self-evaluating the completion condition → transition to `SUCCEEDED`
- Forwarding user messages from the thread directly into the SDK conversation

## Open questions

- Should sessions be listable globally (across all repositories/worktrees) or only scoped to a worktree?
- Should the "Mark as failed" action require confirmation or a reason field?
