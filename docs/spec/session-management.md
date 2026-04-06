# Spec: Session Management

**Status:** implemented
**Last updated:** 2026-04-01

## Summary

A session is a cohesive, purpose-bound unit of coding-agent work attached to a specific worktree. It encapsulates a goal, tracks execution state, captures agent output, and supports user interaction via a resume-based input mechanism. Sessions are created exclusively by the workflow engine — not directly by the user.

## Background

Each session runs a coding agent (Claude SDK as the primary runtime, or Codex SDK) inside a worktree directory. The agent pursues the goal described at session creation and emits a structured transition decision (JSON) as its final output. Users can observe the agent's output stream in real time. When the agent needs clarification, it selects a special `__REQUIRE_USER_INPUT__` transition, which pauses the session until the user provides input, then resumes the same agent session to preserve conversation context.

## Data model

Sessions are persisted in SQLite.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `repository_path` | string | no | Absolute path to the repository |
| `worktree_branch` | string | no | The worktree branch in which the agent runs |
| `goal` | string | no | Free-text description of what the agent should accomplish (may include handoff context from prior steps) |
| `transitions` | string (JSON) | no | Serialised `WorkflowTransition[]` — the workflow-defined transitions (does not include the injected `__REQUIRE_USER_INPUT__`) |
| `transition_decision` | string (JSON) | yes | Serialised `TransitionDecision` emitted by the agent: `{transition, reason, handoff_summary}` |
| `status` | enum | no | `RUNNING` \| `AWAITING_INPUT` \| `SUCCEEDED` \| `FAILED` |
| `terminal_attach_command` | string | yes | Shell command to attach to the live agent (e.g. `claude --resume <claude-session-id>`) |
| `log_file_path` | string | no | Absolute path to the append-only stdout/stderr log file (e.g. `~/.aitm/sessions/<id>.log`) |
| `claude_session_id` | string | yes | The internal agent session ID (Claude or Codex), set once the agent starts |
| `agent_config` | string (JSON) | no | Serialised `AgentConfig` — the resolved agent runtime config for this session (`{"provider":"claude"}` by default) |
| `metadata_fields` | string (JSON) | yes | Serialised `Record<string, OutputMetadataFieldDef>` — metadata fields the agent should extract, resolved from output config |
| `step_execution_id` | string (FK → step_executions) | yes | The workflow step execution that owns this session |
| `created_at` | timestamp | no | When the session was created |
| `updated_at` | timestamp | no | Last status change |

## Session lifecycle

```
            ┌──────────────┐
   create   │              │
  ─────────▶│   RUNNING    │◀──────────────────┐
            │              │                   │
            └──────┬───────┘                   │
                   │                           │
     agent selects │                user sends │ reply
  __REQUIRE_USER_  │                           │
       INPUT__     │                           │
                   ▼                           │
            ┌──────────────┐                   │
            │  AWAITING_   │───────────────────┘
            │    INPUT     │
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
| `RUNNING` | `AWAITING_INPUT` | Agent selects `__REQUIRE_USER_INPUT__` transition |
| `AWAITING_INPUT` | `RUNNING` | User sends a reply; agent session is resumed |
| `RUNNING` | `SUCCEEDED` | Agent emits a valid `transition_decision` (not `__REQUIRE_USER_INPUT__`) |
| `RUNNING` | `FAILED` | User explicitly marks the session as failed; or agent exits without valid output |
| `AWAITING_INPUT` | `FAILED` | User explicitly marks the session as failed |

`SUCCEEDED` and `FAILED` are terminal states. No transitions out of them.

## User input mechanism

### Design

User input is handled entirely at the session level, transparent to the workflow engine. The mechanism works by injecting a special transition into the agent's available options and using the agent runtime's session resume capability to continue the conversation.

### Internal transition type

`WorkflowTransition` (defined in config) remains unchanged. Internally, the session layer works with an extended type:

```typescript
// config.ts — unchanged
type WorkflowTransition =
  | { step: string; when: string }
  | { terminal: "success" | "failure"; when: string }

// Used internally by agent/session layer
type SessionTransition = WorkflowTransition | { user_input: true; when: string }
```

The system always injects one `SessionTransition` of type `{ user_input: true, when: "You need clarification or input from the user before proceeding" }` alongside the workflow-defined transitions. The agent sees this as `__REQUIRE_USER_INPUT__` in its available transition list.

### Flow

1. **Agent selects `__REQUIRE_USER_INPUT__`:** The agent's `TransitionDecision` has `transition: "__REQUIRE_USER_INPUT__"` and `handoff_summary` contains the question for the user.
2. **Session pauses:** `AgentService.startAgent` detects the special transition, sets status to `AWAITING_INPUT`, and suspends (awaits a Promise).
3. **User replies:** The reply API endpoint (`POST /api/sessions/:id/reply`) resolves the pending Promise with the user's input.
4. **Agent resumes:** `startAgent` calls `AgentRuntime.resume()` with the stored `claude_session_id` and the user's message. The agent continues in the same conversation context with the same output format and transitions.
5. **Repeat or complete:** The agent may select `__REQUIRE_USER_INPUT__` again (multiple rounds) or select a real workflow transition, completing the session normally.

### AgentRuntime resume

The `AgentRuntime` interface is extended with a `resume` method:

```typescript
interface AgentRuntime {
  query(params: AgentQueryParams): AsyncIterable<AgentMessage>;
  resume(params: AgentResumeParams): AsyncIterable<AgentMessage>;
  buildTransitionOutputFormat(transitions: WorkflowTransition[]): OutputFormat;
}

interface AgentResumeParams {
  sessionId: string;
  agentSessionId: string;         // claude_session_id from the init message
  prompt: string;                 // the user's reply
  cwd: string;
  command?: string;
  model?: string;
  permissionMode: PermissionMode;
  abortController: AbortController;
  outputFormat?: OutputFormat;
}
```

Runtime-specific resume behaviour:
- **Claude CLI:** `claude --resume <agentSessionId> --print --output-format stream-json ...` with user's message on stdin.
- **Claude SDK:** Call `query()` with `resume: agentSessionId` option.
- **Codex SDK:** Call `thread.runStreamed(userMessage)` on a thread resumed by ID.

### Pending input coordination

`AgentService` uses an in-memory `Map<sessionId, resolve>` to coordinate between the `startAgent` loop and the reply API:

```typescript
private pendingInputs = new Map<string, (input: string) => void>();

// Inside startAgent, after detecting __REQUIRE_USER_INPUT__:
setStatus(sessionId, "AWAITING_INPUT");
const userInput = await new Promise<string>(resolve => {
  this.pendingInputs.set(sessionId, resolve);
});
this.pendingInputs.delete(sessionId);
// resume agent with userInput...

// Called by reply API:
provideInput(sessionId: string, input: string): void {
  this.pendingInputs.get(sessionId)?.(input);
}
```

## Operations

### Create session

Sessions are created internally by the workflow engine, not directly by users.

- Accepts: `repository_path`, `worktree_branch`, `goal`, `transitions`, and an optional `onComplete` callback.
- Persists the session record with `status: RUNNING`.
- Spawns the agent in the worktree directory.
- Stores `terminal_attach_command` and `claude_session_id` once the agent initialises.
- If the agent selects `__REQUIRE_USER_INPUT__`, the session pauses (status: `AWAITING_INPUT`) and waits for user reply before resuming.
- Calls `onComplete(decision)` only when the agent selects a real workflow transition (not `__REQUIRE_USER_INPUT__`), or `null` on failure.

### Get session

- Returns the session record including current status, goal, transitions, transition decision, and terminal attach command.

### List sessions

- Returns all sessions, optionally filtered by `repository_path`, `worktree_branch`, or `status`.
- Ordered by `created_at` descending.

### Mark session as failed

- Accepts a session ID.
- Allowed from `RUNNING` or `AWAITING_INPUT` only.
- Terminates the agent process (or cleans up the pending input Promise).
- Sets `status: FAILED`.

### Reply to session

- Accepts a session ID and the user's reply text.
- Allowed only when `status` is `AWAITING_INPUT`.
- Resolves the pending input Promise in `AgentService`, which resumes the agent session.
- Transitions status to `RUNNING`.

### Stream output

- Provides a real-time stream of the agent's stdout/stderr for a given session.
- Delivered over SSE.
- Historical output since session start is replayed on connection so the UI can render the full buffer.
- Continues streaming through `AWAITING_INPUT` pauses — the stream stays open until a terminal state.

## API surface

| Method | Path | Operation |
|---|---|---|
| `GET` | `/api/sessions` | List |
| `GET` | `/api/sessions/:id` | Get |
| `POST` | `/api/sessions/:id/fail` | Mark as failed |
| `POST` | `/api/sessions/:id/reply` | Reply with user input |
| `GET` | `/api/sessions/:id/stream` | Stream agent output (SSE) |

## Out of scope

- Direct session creation from the UI (sessions are only started via workflow runs).
- Automated failure detection (e.g. exit codes, timeouts) — failure is user-initiated for now.
- Multi-worktree sessions or sessions that span repositories.
- Session re-runs or retries from the UI.

## Decisions

### Process management
Server restarts mark any `RUNNING` session as `FAILED`. `AWAITING_INPUT` sessions survive restarts since they don't depend on in-memory state — the user can still reply after the server comes back. On startup, aitm scans for non-terminal sessions and transitions `RUNNING` ones to `FAILED`.

### Output storage
Agent stdout/stderr is written to an append-only log file at `~/.aitm/sessions/<id>.log`. The path is stored in `log_file_path`. The stream endpoint tails this file and replays it from the beginning on each new connection. Log output from resumed sessions is appended to the same file.

### Structured output
Sessions use the agent runtime's `outputFormat` with a `json_schema` type. The agent's final output is constrained to `{transition, reason, handoff_summary}`. The `__REQUIRE_USER_INPUT__` transition is included in the schema's enum so the agent can select it. This output is stored in `transition_decision` and consumed by the workflow engine (which never sees `__REQUIRE_USER_INPUT__` because the session resolves it internally).

### Workflow transparency
The `AWAITING_INPUT` state and `__REQUIRE_USER_INPUT__` transition are fully encapsulated within the session layer. Session lifecycle changes are communicated via the typed `EventBus` (`src/backend/infra/event-bus.ts`), which emits a discriminated `"session.status-changed"` event. `RUNNING` and `AWAITING_INPUT` carry only `{ sessionId, status }`, `FAILED` carries `{ sessionId, status, decision: null }`, and `SUCCEEDED` carries `{ sessionId, status, decision }`. `WorkflowRunService` subscribes to this event in its constructor to keep the step execution status in sync and to advance the workflow when a session reaches a terminal state. From the workflow's perspective, the session is simply `RUNNING` for longer.
