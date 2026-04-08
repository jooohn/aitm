# Spec: Workflow Run

**Status:** implemented
**Last updated:** 2026-03-29

## Summary

A workflow run represents a single execution of a named workflow against a worktree. It groups the sequence of Claude Code sessions that advance through the workflow's step machine, tracks the current step, and records the terminal outcome. It is the primary unit of work the user monitors in aitm.

## Requirements

### Data model

A workflow run has:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `worktree_branch` | string | The worktree this run is executing against |
| `repository_path` | string | Absolute path to the repository |
| `workflow_name` | string | Name of the workflow as defined in `~/.aitm/config.yaml` |
| `current_step` | string \| null | Name of the currently active step, or `null` if terminal |
| `status` | enum | `running` \| `awaiting` \| `success` \| `failure` |
| `inputs` | JSON \| null | User-provided workflow input values as `Record<string, string>` |
| `metadata` | JSON \| null | Accumulated metadata extracted from step executions |
| `created_at` | timestamp | When the run was initiated |
| `updated_at` | timestamp | When the run last transitioned |

The `awaiting` status is set when the workflow reaches a manual approval step or when a session requires user input.

Each workflow run owns an ordered list of **step executions** — one per session that ran:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `workflow_run_id` | string | Parent workflow run |
| `step` | string | Name of the step this execution corresponds to |
| `step_type` | enum | `agent` \| `command` \| `manual-approval` — the type of step executed |
| `session_id` | string \| null | The agent session that executed this step (null for command/manual-approval steps) |
| `command_output` | string \| null | Captured stdout/stderr for command steps |
| `transition_decision` | JSON \| null | Structured JSON emitted by the agent: `{"transition": <step or terminal>, "reason": "..."}` |
| `handoff_summary` | string \| null | Plain-text summary emitted by the agent for the next step's context |
| `created_at` | timestamp | When this step execution started |
| `completed_at` | timestamp \| null | When the step completed and the transition was recorded |

### Lifecycle

```
initiated
    │
    ▼
[initial_step] ──► step starts
                         │
              ┌──────────┼──────────────────┐
              ▼          ▼                  ▼
          agent step  command step    manual-approval step
              │          │                  │
         session runs  command executes   status: awaiting
              │          │                  │
              │          │           user approves/rejects
              │          │                  │
              └──────────┴──────────────────┘
                         │
                  transition decided
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      next step exists         terminal transition
              │                     │
         new step starts       workflow run ends
                               status: success | failure
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
    handoff_summary: { type: "string" },
    clarifying_question: { type: "string" }
  },
  required: ["transition", "reason", "handoff_summary", "clarifying_question"],
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
- Suggested follow-up workflows when other workflow definitions declare
  `suggest_if` rules that match the current run context

### Relationship to sessions

- A session belongs to at most one step execution.
- Sessions are still viewable independently (existing session detail page).
- The workflow run detail page links to individual sessions for full log access.

### Operations

#### Stop workflow run

Emergency stop for a running workflow. Terminates the active session (if any) and marks the workflow run as `failure`.

#### Re-run workflow

Creates a new workflow run for the same worktree and workflow, starting from `initial_step`. The original run is preserved for audit.

#### Re-run from failed state

Retries a failed workflow run by re-executing the last step that failed. Reuses the existing workflow run record.

#### Resolve manual approval

Resolves a workflow run that is `awaiting` a manual approval. Accepts an approve/reject decision and an optional reason. On approval, the workflow advances to the next step per the approval step's transitions. On rejection, the corresponding rejection transition fires.

### API surface

| Method | Path | Operation |
|---|---|---|
| `GET` | `/api/workflow-runs` | List workflow runs |
| `GET` | `/api/workflow-runs/:id` | Get workflow run detail |
| `POST` | `/api/workflow-runs` | Create a new workflow run |
| `POST` | `/api/workflow-runs/:id/stop` | Stop a running workflow |
| `POST` | `/api/workflow-runs/:id/rerun` | Re-run a completed workflow |
| `POST` | `/api/workflow-runs/:id/rerun-from-failed` | Retry from the failed step |
| `POST` | `/api/workflow-runs/:id/resolve` | Resolve a manual approval |

### Crash recovery

On server startup, `recoverCrashedWorkflowRuns()` handles workflow runs and step executions left in non-terminal states due to a crash or restart:

1. **Pending succeeded executions** — step executions with a stored transition decision but whose workflow run was not advanced. Replays `completeStepExecution()` to advance the workflow.
2. **Pending failed executions** — step executions whose session failed but the workflow was not updated. Closes the execution and retries the same step.
3. **Orphaned command executions** — command step executions left running (command steps are synchronous, so a crash means unrecoverable). Marks the workflow run as `failure`.
4. **Remaining uncompleted executions** — closes any dangling executions if the workflow already reached a terminal state.
5. **Remaining running workflow runs** — any workflow runs still in `running` status after the above steps are marked as `failure`.

## Out of scope

- Manually overriding a transition (forcing a specific next step) — future enhancement
- Parallel step execution (all runs are strictly sequential for now)

## Decisions

- **Transition decision format**: The Agent SDK's `outputFormat` option constrains Claude's final output to a validated JSON schema. No manual JSON parsing; SDK guarantees structure.
- **Auto-advance**: aitm automatically starts the next session after a transition. A per-transition `confirm: true` option can be added in the config later.
