# DB access via repository modules

**Date:** 2026-04-01
**Status:** accepted (see also: `20260401-160000-constructor-injected-service-classes.md` for how repositories are wired into services)

## Context

Domain modules (`sessions/index.ts`, `workflow-runs/index.ts`) mixed business logic with raw `db.prepare(...)` calls. This made it difficult to see what a function's actual responsibility was — orchestration, validation, and SQL were interleaved in the same function body. It also spread knowledge of table schemas across many call sites, making schema changes risky.

## Decision

All direct database access must go through dedicated repository modules (`*-repository.ts`) co-located with their domain module. Domain modules import the repository and call its functions; they never import `db` or execute queries directly.

Concretely:

- `sessions/session-repository.ts` owns reads and writes to the `sessions` and `session_messages` tables.
- `workflow-runs/workflow-run-repository.ts` owns reads and writes to the `workflow_runs` and `state_executions` tables.
- Repository functions are thin wrappers around SQL plus persistence-adjacent publication of DB-change events. They accept plain parameters and return typed results. They do not call other domain functions, but they may publish event-bus notifications when a write actually changes persisted state.
- Domain modules (`sessions/index.ts`, `workflow-runs/index.ts`) handle orchestration, validation, and non-persistence side effects (e.g. spawning agents, deleting log files) by calling repository functions for persistence.

Cross-table transactions (e.g. `deleteWorktreeData` which touches all four tables) live in the repository that initiates the operation, keeping the transaction boundary explicit and atomic.

## Consequences

- Adding or changing a column requires updating only the repository module and its types — domain logic is unaffected as long as the repository function signature stays the same.
- Event publication for persisted status changes is co-located with the write path, reducing the risk that a service updates the DB but forgets to emit the matching event.
- Repository functions can be easily substituted in tests if needed, since all DB access flows through a single import.
- New domain modules should follow the same pattern: create a co-located `*-repository.ts` for all database access.

## Alternatives considered

- **Keep queries inline in domain modules** — the prior approach. Simple for small modules but scales poorly; schema knowledge is scattered and hard to refactor.
- **Central repository module for all tables** — reduces file count but creates a single large file with no clear ownership boundary. Co-location with the domain module is a better fit for this codebase's structure.
- **ORM / query builder** — adds a dependency and abstraction layer that is unnecessary for a project using a single SQLite database with straightforward queries.
