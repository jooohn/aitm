# Domain result type for error handling

**Date:** 2026-04-12
**Status:** accepted

## Context

Domain service methods used two different conventions for expressing failure: throwing `DomainError` subclasses (e.g. `NotFoundError`, `ValidationError`) and returning `undefined`. Both hide the error path from type signatures — callers must remember to wrap calls in try/catch or check for `undefined`, and the compiler cannot enforce either. Route handlers already use a discriminated-union `ApiResult<T>` for their own control flow, so the pattern is familiar in this codebase.

## Decision

Introduce `DomainResult<T, E>` — a discriminated union for domain-layer error handling — and migrate domain methods incrementally.

Concretely:

- `src/backend/domain/result.ts` exports the type and helpers: `ok(value)`, `err(error)`, `mapResult`, `flatMapResult`, `flatMapResultAsync`, and `unwrap` (extracts value or throws on err, for use when failure is logically impossible).
- Domain methods that can fail return `DomainResult<T, SpecificError>` instead of throwing or returning `undefined`. The error type parameter is narrowed to the specific errors a method can produce (e.g. `DomainResult<Session, NotFoundError | ValidationError>`).
- `domainResultToResponse` in `src/backend/api/error-response.ts` bridges the two layers: it converts a `DomainResult<T, DomainError>` directly into a `NextResponse` using `DomainError.statusCode`, so route handlers can compose domain results monadically with `mapResult`/`flatMapResult` and fold the final result into a response in one call.
- Migration is incremental. Non-migrated methods continue throwing; route handlers use try/catch for those and `domainResultToResponse` for migrated ones. Both styles coexist.

Initial migration covers `SessionService.getSession`, `failSession`, and `replyToSession`.

## Consequences

- Error paths are visible in type signatures — the compiler enforces that callers handle them.
- Combinators (`map`, `flatMap`) allow composing fallible operations without nested if/else chains.
- Two error-handling styles coexist during migration. New domain methods should prefer `DomainResult`; existing methods can be migrated opportunistically.
- The bridge function lets route handlers compose domain results monadically and fold the final result into a response without intermediate early returns.
- `unwrap` provides an escape hatch for cases where an err is logically unreachable (e.g. reading back a just-inserted record), trading a compile-time guarantee for a clearer runtime error than a bare `as` cast.

## Alternatives considered

- **Keep throwing exceptions** — the prior approach. Works but error paths are invisible to the type system, and try/catch blocks are easy to forget or place incorrectly.
- **Return `T | undefined`** — already used by `getSession`. Loses error detail (callers cannot distinguish "not found" from other failures) and doesn't compose.
- **Use a library (neverthrow, fp-ts Either)** — adds a dependency for a small amount of code. The custom type is ~30 lines, tailored to the codebase's conventions, and avoids the learning curve of a full FP library.
- **Big-bang migration of all methods at once** — higher risk and larger PR. Incremental migration lets each method be reviewed and tested independently.
