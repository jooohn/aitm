# Spec: Workflow Run

**Status:** implemented
**Last updated:** 2026-03-29

## Summary

A workflow run represents a single execution of a named workflow against a worktree. It groups the sequence of Claude Code sessions that advance through the workflow's step machine, tracks the current step, and records the terminal outcome. It is the primary unit of work the user monitors in aitm.

## Requirements

### Data model

A workflow run has:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `worktree_branch` | The worktree this run is executing against |
| `repository_path` | Absolute path to the repository |
| `workflow_name` | Name of the workflow as defined in `~/.aitm/config.yaml` |
| `current_step` | Name of the currently active step, or `null` if terminal |
| `status` | `running` \| `success` \| `failure` |
| `created_at` | When the run was initiated |
| `updated_at` | When the run last transitioned |

Each workflow run owns an ordered list of **step executions** — one per session that ran:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `workflow_run_id` | Parent workflow run |
| `step` | Name of the step this execution corresponds to |
| `session_id` | The Claude Code session that executed this step |
| `transition_decision` | Structured JSON emitted by Claude: `{"transition": <step or terminal>, "reason": "..."}` |
| `handoff_summary` | Plain-text summary emitted by Claude for the next step's context |
| `created_at` | When this step execution started |
| `completed_at` | When Claude's session ended and the transition was recorded |

### Lifecycle

```
initiated
    │
    ▼
[initial_step] ──► session starts
                         │
                    session ends, Claude emits:
                    - transition_decision
                    - handoff_summary
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      next step exists         terminal transition
              │                     │
         new session           workflow run ends
          starts               status: success | failure
```

1. User initiates a workflow run against a worktree, selecting a workflow by name.
2. aitm creates the workflow run record and starts a session for `initial_step`.
3. The session's system prompt includes:
   - The step's `goal`
   - The handoff context from the previous step execution (if any): summary + path to previous session log
   - An instruction to emit a structured transition decision and handoff summary as the final output
4. When the session ends, aitm reads the transition decision and either:
   - Creates a new session for the next step (updating `current_step`)
   - Marks the workflow run terminal (`status: success | failure`, `current_step: null`)

### Session prompt construction

For the first step execution, the session receives:

```
<goal>
{step.goal}
</goal>
```

For subsequent step executions, the session additionally receives the full history of all completed prior steps (oldest first):

```
<handoff>
Previous steps (oldest first):

Step: {step_execution_1.step}
Summary: {step_execution_1.handoff_summary}
Log: {session_1.log_file_path}

Step: {step_execution_2.step}
Summary: {step_execution_2.handoff_summary}
Log: {session_2.log_file_path}

</handoff>
```

Only step executions that produced a non-null handoff summary are included. The log file path is available for deeper inspection but is not loaded automatically.

The session is invoked via the Agent SDK's `query()` with an `outputFormat` schema. This constrains Claude's final output to a validated JSON structure — no manual parsing or failure-on-malformed-JSON needed:

```typescript
outputFormat: {
  type: "object",
  properties: {
    transition: { type: "string" },   // next step name, "success", or "failure"
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

- Active workflow run (if any): current step, status, elapsed time
- Past workflow runs: outcome, steps traversed, timestamps

A workflow run detail page shows:
- The sequence of step executions in order
- For each: step name, session link, transition decision, handoff summary
- Overall run status and terminal outcome

### Relationship to sessions

- A session belongs to at most one step execution.
- Sessions are still viewable independently (existing session detail page).
- The workflow run detail page links to individual sessions for full log access.

## Out of scope

- Manually overriding a transition (forcing a specific next step) — future enhancement
- Pausing or resuming a workflow run mid-execution
- Parallel step execution (all runs are strictly sequential for now)
- Human-in-the-loop steps

## Decisions

- **Transition decision format**: The Agent SDK's `outputFormat` option constrains Claude's final output to a validated JSON schema. No manual JSON parsing; SDK guarantees structure.
- **Auto-advance**: aitm automatically starts the next session after a transition. A per-transition `confirm: true` option can be added in the config later.

