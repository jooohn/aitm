# Constructor-injected service classes

**Date:** 2026-04-01
**Status:** accepted

## Context

Domain modules exported standalone functions that imported their dependencies (repositories, other services) from a central `container.ts` module at the top level. This created implicit dependencies — it was impossible to tell from a function's signature what it relied on — and introduced fragile circular import chains (e.g. `container` -> `sessions` -> `agent` -> `container`). Testing required module-level `vi.mock()` calls to intercept these hidden imports.

## Decision

Every domain module wraps its public functions in a service class that receives all dependencies via its constructor. A central `container.ts` wires everything together.

Concretely:

- Each domain module under `src/backend/domain/` lives in its own directory (e.g. `sessions/`, `worktrees/`, `agent/`) and exports a service class (e.g. `SessionService`, `WorktreeService`, `AgentService`) from `index.ts`.
- Service classes receive their dependencies (repositories, other services) as constructor parameters. They never import other service instances directly.
- Pure functions (e.g. `inferAlias`, `parseWorktreeList`) remain standalone exports alongside their service class — they have no dependencies and need no injection.
- `src/backend/container.ts` is the single composition root. It instantiates all repositories and services, wiring them together. Application code (route handlers, pages, instrumentation) imports service instances from `container.ts`.
- Type-only imports between domain modules (e.g. `import type { WorktreeService }`) are allowed and do not create runtime circular dependencies.
- Where a true circular dependency exists at the interface level (e.g. `AgentService` needs to save messages via `SessionRepository`), a narrow callback interface (e.g. `AgentMessageSink`) is used to break the cycle.

## Consequences

- Dependencies are explicit and visible in each class constructor, making the code easier to reason about.
- Tests spy on service instances (`vi.spyOn(sessionService, "createSession")`) rather than using `vi.mock()` on module paths, eliminating brittle path-based mocking.
- Adding a new service requires creating the class, instantiating it in `container.ts`, and passing it to any services that depend on it.
- The composition root (`container.ts`) is the single place to understand the full dependency graph.

## Alternatives considered

- **Keep standalone functions with module-level imports** — the prior approach. Simple for small codebases but creates implicit coupling and fragile circular imports that are hard to debug.
- **Dependency injection framework** (e.g. tsyringe, inversify) — adds runtime overhead, decorators, and a learning curve. Manual constructor injection is sufficient for this codebase's size.
- **Factory functions instead of classes** — functionally equivalent but classes provide a natural home for private methods and state (e.g. `AgentService`'s pending-input maps), and make the pattern immediately recognizable.
