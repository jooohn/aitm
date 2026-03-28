# Spec: Workflow Run

**Status:** draft
**Last updated:** 2026-03-28

## Summary

A workflow run represents a single execution of a named workflow against a worktree. It groups the sequence of Claude Code sessions that advance through the workflow's state machine, tracks the current state, and records the terminal outcome. It is the primary unit of work the user monitors in aitm.

## Requirements

### Data model

A workflow run has:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `worktree_branch` | The worktree this run is executing against |
| `repository_id` | The repository the worktree belongs to |
| `workflow_name` | Name of the workflow as defined in `~/.aitm/config.yaml` |
| `current_state` | Name of the currently active state, or `null` if terminal |
| `status` | `running` \| `success` \| `failure` |
| `created_at` | When the run was initiated |
| `updated_at` | When the run last transitioned |

Each workflow run owns an ordered list of **state executions** — one per session that ran:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `workflow_run_id` | Parent workflow run |
| `state` | Name of the state this execution corresponds to |
| `session_id` | The Claude Code session that executed this state |
| `transition_decision` | Structured JSON emitted by Claude: `{"transition": <state or terminal>, "reason": "..."}` |
| `handoff_summary` | Plain-text summary emitted by Claude for the next state's context |
| `created_at` | When this state execution started |
| `completed_at` | When Claude's session ended and the transition was recorded |

### Lifecycle

```
initiated
    │
    ▼
[initial_state] ──► session starts
                         │
                    session ends, Claude emits:
                    - transition_decision
                    - handoff_summary
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      next state exists        terminal transition
              │                     │
         new session           workflow run ends
          starts               status: success | failure
```

1. User initiates a workflow run against a worktree, selecting a workflow by name.
2. aitm creates the workflow run record and starts a session for `initial_state`.
3. The session's system prompt includes:
   - The state's `goal`
   - The handoff context from the previous state execution (if any): summary + path to previous session log
   - An instruction to emit a structured transition decision and handoff summary as the final output
4. When the session ends, aitm reads the transition decision and either:
   - Creates a new session for the next state (updating `current_state`)
   - Marks the workflow run terminal (`status: success | failure`, `current_state: null`)

### Session prompt construction

For the first state execution, the session receives:

```
<goal>
{state.goal}
</goal>
```

For subsequent state executions, the session additionally receives:

```
<handoff>
Previous state: {previous_state_execution.state}
Summary: {previous_state_execution.handoff_summary}
Full log: {previous_session.log_file_path}
</handoff>
```

The session is invoked via the Agent SDK's `query()` with an `outputFormat` schema. This constrains Claude's final output to a validated JSON structure — no manual parsing or failure-on-malformed-JSON needed:

```typescript
outputFormat: {
  type: "object",
  properties: {
    transition: { type: "string" },   // next state name, "success", or "failure"
    reason: { type: "string" },
    handoff_summary: { type: "string" }
  },
  required: ["transition", "reason", "handoff_summary"],
  additionalProperties: false
}
```

aitm reads `transition` from the structured output to advance the run. If the session ends without producing a valid output (e.g. SDK error), the run is marked `failure`.

### UI

A workflow run surfaces as a top-level entity in the UI, associated with a worktree. The worktree detail page shows:

- Active workflow run (if any): current state, status, elapsed time
- Past workflow runs: outcome, states traversed, timestamps

A workflow run detail page shows:
- The sequence of state executions in order
- For each: state name, session link, transition decision, handoff summary
- Overall run status and terminal outcome

### Relationship to sessions

- A session belongs to at most one state execution.
- Sessions are still viewable independently (existing session detail page).
- The workflow run detail page links to individual sessions for full log access.

## Out of scope

- Manually overriding a transition (forcing a specific next state) — future enhancement
- Pausing or resuming a workflow run mid-execution
- Parallel state execution (all runs are strictly sequential for now)
- Human-in-the-loop states

## Decisions

- **Transition decision format**: The Agent SDK's `outputFormat` option constrains Claude's final output to a validated JSON schema. No manual JSON parsing; SDK guarantees structure.
- **Auto-advance**: aitm automatically starts the next session after a transition. A per-transition `confirm: true` option can be added in the config later.
