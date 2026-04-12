# Command execution as first-class resource

**Date:** 2026-04-12
**Status:** accepted

## Context

The `StepExecution` model handled agent steps and command steps asymmetrically. Agent steps had a dedicated `sessions` table (linked via LEFT JOIN on `step_execution_id`) that stored runtime state, log paths, and lifecycle status. Command steps, however, embedded their output path directly on `step_executions` with no dedicated backing record — meaning there was no structured place to store command-specific metadata like the executed command string, working directory, exit code, or execution timing.

This asymmetry caused several problems:

- **Crash recovery** had to infer command step orphans indirectly: "incomplete step execution with no linked session and not manual-approval" — a fragile negative check rather than a positive one.
- **MCP resources** could expose `aitm://sessions/{id}` for agent steps but had no equivalent for command steps, limiting agent introspection of command failures.
- **Future async command execution** would require a status model and lifecycle tracking that had nowhere to live.

## Decision

Introduce a `command_executions` table and `CommandExecution` domain type, following the same structural pattern as `sessions`:

- **Linkage:** `command_executions` has a `step_execution_id` FK. `StepExecution` gains a `command_execution_id` populated via LEFT JOIN — the same pattern used for `session_id`.
- **Fields:** `id`, `step_execution_id`, `command`, `cwd`, `status` (running/success/failure), `exit_code`, `output_file_path`, `created_at`, `completed_at`.
- **Lifecycle:** The step runner creates a `command_execution` record before executing, then completes it with status, exit code, and output path afterward.
- **Backward compatibility:** `output_file_path` is dual-written to both `command_executions` and `step_executions`. Existing rows without a `command_executions` record continue to work (the LEFT JOIN returns NULL).
- **Crash recovery:** `failRunningCommandExecutions()` marks orphaned running command executions as failed. The orphan detection query now positively checks for running command executions rather than relying on negative inference.
- **MCP resource:** `aitm://command-executions/{id}` returns command execution detail as JSON.

No lifecycle events, dedicated API route, or UI changes — command execution remains synchronous and the existing output drawer works via `output_file_path`.

## Consequences

- Agent steps and command steps now have symmetric backing records (`sessions` and `command_executions`), making the domain model more consistent and easier to reason about.
- Crash recovery logic is more explicit: it checks for running `command_executions` directly rather than inferring orphans through exclusion.
- MCP agents can inspect command execution details (command, cwd, exit code) through `aitm://command-executions/{id}`.
- The `status` and `completed_at` fields accommodate future async command execution without schema changes.
- Legacy command step executions (without a `command_executions` row) continue to work — no backfill migration needed.
- `output_file_path` is temporarily dual-written; a future cleanup can remove it from `step_executions` once all consumers read from `command_executions`.

## Alternatives considered

- **Polymorphic `execution_resource_id` on `step_executions`** — a single column plus discriminator could reference either `sessions` or `command_executions`. Rejected because it requires application-level dispatch and prevents type-safe FK joins.
- **Embed command metadata directly on `step_executions`** — add `command`, `cwd`, `exit_code` columns to the existing table. Rejected because it further bloats a table that should be a backend-agnostic orchestration record, and it doesn't provide a clean place for command-specific lifecycle tracking.
- **Do nothing** — the existing approach worked but left crash recovery fragile and blocked MCP resource parity for command steps.
