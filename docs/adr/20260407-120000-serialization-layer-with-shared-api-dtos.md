# Serialization layer with shared API DTOs

**Date:** 2026-04-07
**Status:** accepted

## Context

Domain models (`WorkflowRun`, `Session`, `StepExecution`) stored JSON-encoded columns in SQLite (e.g. `inputs`, `metadata`, `transitions`, `transition_decision`, `agent_config`). These columns were kept as raw `string` types throughout the domain layer, so `JSON.parse()` calls were scattered across services, API routes, and frontend components. This caused several problems:

- **No single source of truth for the API contract.** Frontend and backend independently defined overlapping types, with no guarantee they agreed on shape.
- **Stringly-typed domain models.** Services and repositories passed around JSON strings instead of typed objects, deferring parsing until the point of use.
- **Duplicated, inconsistent parsing.** Multiple call sites parsed the same JSON fields with subtly different error handling (or none at all).
- **Fragile crash recovery.** When recovering in-flight step executions, the system re-parsed `transition_decision` from its string form; a malformed value could crash the recovery path.

## Decision

Introduce a three-layer serialization architecture:

### 1. Repository serializers (`*-serializer.ts`) own the DB ↔ Domain boundary

Each repository gets a co-located serializer module that converts between database row types (JSON strings) and typed domain objects. Row types (`WorkflowRunRow`, `SessionRow`) are defined in the serializer and are not visible outside the repository.

- **On read:** `workflowRunRowToDomain(row)` parses all JSON columns into typed objects.
- **On write:** `serializeSessionInsert(params)` converts typed domain objects back into JSON strings for storage.

All JSON parsing is defensive: malformed values produce `null` rather than throwing, and `Record<string, string>` fields silently drop non-string values. This protects crash-recovery and migration paths.

### 2. Domain models carry parsed, typed fields

Domain interfaces (`WorkflowRun`, `Session`, etc.) now use concrete types for previously-stringly fields:

| Field | Before | After |
|---|---|---|
| `inputs` | `string \| null` | `Record<string, string> \| null` |
| `metadata` | `string \| null` | `Record<string, string> \| null` |
| `transitions` | `string` | `WorkflowTransition[]` |
| `transition_decision` | `string \| null` | `TransitionDecision \| null` |
| `agent_config` | `string` | `AgentConfig` |

Services consume typed objects directly and never call `JSON.parse()`.

### 3. Shared DTO contracts (`src/shared/contracts/api.ts`) define the API surface

A single `api.ts` file under `src/shared/contracts/` defines every DTO type returned by API routes. Both backend route handlers (via thin mappers in `src/backend/api/dto.ts`) and the frontend API client import from this file.

The DTO mapper layer is intentionally thin — mostly spreading the domain object. Its purpose is to strip internal-only fields (e.g. `step_count_offset`) and provide an explicit place where the public contract is shaped, even when the shape happens to match the domain model today.

## Consequences

- **Single validation point.** All JSON deserialization happens in serializer modules. Adding or changing a JSON column requires updating only the serializer and its tests.
- **Crash-safe recovery.** `transition_decision` is already parsed when the recovery path reads it — no try/catch around `JSON.parse` needed at the call site.
- **Shared contract.** Frontend and backend import the same DTO types. Changing an API shape requires updating `api.ts`, which immediately surfaces type errors on both sides.
- **Frontend simplification.** The API client no longer defines its own parallel type hierarchy; it re-exports DTO types from the shared contract.
- **Defensive by default.** Malformed JSON in the database (from bugs, manual edits, or schema migrations) is silently coerced to safe defaults rather than crashing reads.

## Alternatives considered

- **Parse at the service layer, not the repository.** Keeps repositories as pure SQL wrappers. Rejected because it re-scatters parsing across every service method that touches a JSON field, which was the original problem.
- **Use a validation library (e.g. Zod) for runtime parsing.** Provides richer schema validation but adds a dependency and indirection. The hand-written parsers are small, co-located, and sufficient for the limited set of JSON shapes in this project.
- **Codegen DTOs from an OpenAPI spec.** Would give stronger guarantees about the frontend-backend contract. Rejected as premature — the API surface is small and changes infrequently. A shared TypeScript file achieves the same type-safety goal with less tooling overhead.
- **Keep JSON strings in domain models and parse only at the API boundary.** Would limit the scope of changes but leaves services working with untyped data, which is the root cause of the bugs and duplication this change addresses.
