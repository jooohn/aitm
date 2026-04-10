# Split workflow orchestration into focused collaborators

**Date:** 2026-04-10
**Status:** accepted

## Context

The `workflow-runs/` subsystem concentrated several distinct responsibilities in two large files:

- **`index.ts` (~450 lines):** Workflow creation, input validation, filesystem artifact materialization, git metadata management (`.git`/`commondir`/`info/exclude`), event-bus wiring, lifecycle orchestration, and legacy command-output backfilling.
- **`step-runner.ts` (~320 lines):** Step dispatch, goal/prompt construction, artifact path resolution, command output persistence, and session creation.

This made it difficult to test individual concerns in isolation — git-exclude logic was buried in a private method, goal-building was only tested indirectly through `StepRunner` integration tests, and filesystem setup was interleaved with orchestration logic.

## Decision

Extract three focused modules from the two large files. No behavior changes — pure structural refactoring.

### `goal-builder.ts` — Pure functions for prompt construction

Extracted `buildGoal` and `resolveWorkflowArtifacts` from `step-runner.ts`. These are pure functions that build the structured goal string from step goals, previous executions, artifacts, and inputs. `StepRunner` imports and delegates to them.

### `git-exclude-manager.ts` — Stateless git info/exclude utilities

Extracted `resolveGitDir`, `resolveGitInfoDir`, and the idempotent exclude-entry logic from `index.ts`. Handles worktree `gitdir:` indirection and `commondir` resolution. Stateless free functions — no class needed.

### `workflow-run-materializer.ts` — Filesystem setup service

Extracted `ensureWorkflowRunDir`, `materializeWorkflowArtifacts`, and `ensureLegacyCommandOutputFiles` into a constructor-injected class (consistent with the codebase's service pattern from ADR `20260401-160000-constructor-injected-service-classes`). Also absorbed the `buildCommandOutputHandoffSummary` helper. `WorkflowRunService` delegates to this collaborator.

### What stays in the original files

- **`WorkflowRunService` (`index.ts`):** Workflow creation, rerun, stop, completion, manual approval, queries, and event-bus wiring.
- **`StepRunner` (`step-runner.ts`):** Step dispatch, command/agent/manual-approval execution, session creation, and command output persistence.

## Consequences

- Each extracted concern is independently unit-testable: 31 new tests across the three modules (12 for goal-builder, 10 for git-exclude-manager, 9 for workflow-run-materializer).
- All 125 existing workflow-runs tests pass unchanged, confirming behavior preservation.
- `index.ts` shrank by ~100 lines, reducing cognitive load when working on orchestration logic.
- Adding new artifact types or changing git-exclude behavior no longer requires reading the full `WorkflowRunService`.

## Alternatives considered

- **Leave as-is** — the code worked, but growing file sizes were making it harder to reason about individual concerns and write focused tests.
- **Extract into a single "workflow-run-setup" module** — would still mix git, filesystem, and prompt concerns. Finer granularity better matches the distinct responsibilities.
- **Use classes for all extractions** — `GoalBuilder` and `GitExcludeManager` are stateless with no constructor dependencies, so free functions are more appropriate (consistent with existing utilities like `parseWorktreeList`).
