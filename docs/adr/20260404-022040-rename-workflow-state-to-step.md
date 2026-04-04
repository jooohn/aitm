# Rename WorkflowState to WorkflowStep

**Date:** 2026-04-04
**Status:** accepted

## Context

The codebase used "state" as the term for individual units of work within a workflow (e.g., `WorkflowState`, `initial_state`, `states`, `StateExecution`). While "state" is accurate from a state-machine perspective, in the context of a workflow it caused confusion:

- "State" is overloaded — it could refer to a workflow step definition, a runtime condition (running/success/failure), or React component state.
- The actual data (`goal`, `command`, `transitions`) describes an action to perform, not a condition. This is better described as a "step."
- Having both `WorkflowState` (definition) and `StateExecution` (runtime) was ambiguous. `WorkflowStep` + `StepExecution` is clearer.

## Decision

Rename "state" to "step" across the entire codebase:

- **Types:** `WorkflowState` → `WorkflowStep`, `AgentWorkflowState` → `AgentWorkflowStep`, `CommandWorkflowState` → `CommandWorkflowStep`, `StateExecution` → `StepExecution`, `CommandStateExecutor` → `CommandStepExecutor`.
- **Config YAML keys:** `initial_state` → `initial_step`, `states` → `steps`, transition target `state:` → `step:`.
- **DB schema:** table `state_executions` → `step_executions`, columns `state` → `step`, `state_type` → `step_type`, `current_state` → `current_step`, `state_execution_id` → `step_execution_id`.
- **Files:** `WorkflowStateDiagram` → `WorkflowStepDiagram`, `command-state-executor` → `command-step-executor`, route directory `state-executions/` → `step-executions/`.
- **UI text:** all user-facing labels updated from "state" to "step."

## Consequences

- Existing databases are incompatible; `npm run db:clean` is required.
- Existing `config.yaml` files must be updated to use `initial_step`, `steps`, and `step:` in transitions.
- The URL for step execution detail pages changed from `/workflow-runs/:id/state-executions/:execId` to `/workflow-runs/:id/step-executions/:execId`.

## Alternatives considered

- **"Stage"** — considered but rejected. "Stage" implies a broader phase with less defined boundaries, while "step" better conveys a discrete, sequential unit of work.
- **Rename only types, keep DB as-is** — rejected in favor of full consistency since the project is early-stage and a clean DB reset is acceptable.
