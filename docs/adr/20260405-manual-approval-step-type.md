# ADR: Manual Approval as a Step Type

**Status:** accepted
**Date:** 2026-04-05

## Context

As workflows grew more complex, users needed human checkpoints — points where a human reviews the work so far and decides whether to proceed. Several designs were considered:

1. **Transition modifier**: Add a `confirm: true` flag on transitions so aitm pauses before advancing.
2. **Separate concept**: Model approvals as a distinct entity outside the step graph.
3. **Step type**: Model manual approval as a first-class step type alongside agent and command steps.

The transition-modifier approach only gates the transition between steps, not the step itself. It cannot express "stop here and wait for a human decision that determines which transition to take." The separate-concept approach adds complexity by introducing a parallel control-flow mechanism outside the directed graph.

## Decision

Model manual approval as a step type (`type: manual-approval`) within the existing workflow step graph. A manual approval step has `transitions` just like any other step, but instead of running an agent or command, it sets the workflow run to `awaiting` status and waits for a human to resolve it.

Resolution is done via `POST /api/workflow-runs/:id/resolve` with an approve/reject decision and optional reason. The decision maps to one of the step's configured transitions to advance the workflow.

## Consequences

- **Uniform graph model**: Manual approvals are steps in the directed graph, using the same transition mechanism as agent and command steps. No special control-flow concepts needed.
- **Awaiting status**: Introduces the `awaiting` status on workflow runs, used when the run is blocked on human input (manual approval or user input to a session).
- **Step type field**: Step executions gain a `step_type` field (`agent` | `command` | `manual-approval`) to distinguish execution behavior.
- **No session**: Manual approval steps do not create agent sessions — `session_id` is null on their step executions.
- **Event-driven**: Resolution emits events via the EventBus, keeping the workflow engine decoupled from the approval UI.
