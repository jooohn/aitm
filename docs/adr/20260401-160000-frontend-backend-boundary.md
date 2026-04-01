# Frontend must not import backend modules directly

**Date:** 2026-04-01
**Status:** accepted

## Context

Several Next.js page components under `src/app/` were importing directly from `@/backend` (services, domain functions). This created a tight coupling between the presentation layer and the backend, making it unclear which code runs where and making it harder to enforce a clean API boundary.

## Decision

Files under `src/app/` must not import from `@/backend`. Only API route handlers (`src/app/api/`) may depend on `@/backend`.

- **Pages and components** fetch data via the API client (`@/lib/utils/api`).
- **Pure shared utilities** (e.g. `inferAlias`) that have no backend dependencies live in `src/lib/utils/` and may be imported from anywhere.
- **Server Components that previously called backend services directly** are converted to client components that use the API client.

## Consequences

- All data access from UI code goes through HTTP API routes, making the API surface explicit.
- Pages are now client components, so initial renders happen client-side rather than server-side. This is acceptable for this application (internal tooling, not SEO-sensitive).
- New API endpoints may need to be created when pages require data not yet exposed via the API.

## Alternatives considered

- **Server-side data layer**: Create a shared data-fetching module that both API routes and Server Components use. Rejected because it blurs the boundary and still allows pages to bypass the API.
- **Keep Server Components with internal fetch**: Have Server Components call their own API routes via `fetch()`. Rejected because calling your own API from Server Components is fragile (requires knowing the base URL) and is a Next.js anti-pattern.
