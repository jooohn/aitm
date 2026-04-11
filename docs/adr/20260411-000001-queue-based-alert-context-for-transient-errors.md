# Queue-based AlertContext for transient errors

**Date:** 2026-04-11
**Status:** accepted

## Context

Transient errors (e.g. 5xx API failures) were handled per-component with local state, leading to inconsistent UX and missed errors. We needed a centralized mechanism for surfacing these errors to users.

## Decision

Introduce a global `AlertContext` (React Context + Provider) under `src/lib/alert/` that any component can use to push alert messages via a `useAlert` hook.

Key design choices:

- **Queue-based display:** Alerts are enqueued and shown one at a time, auto-dismissing after 3 seconds (or on manual dismiss), then dequeuing the next.
- **Provider placement:** `AlertProvider` wraps children inside `SWRProvider` (`src/app/SWRProvider.tsx`), keeping `layout.tsx` as a server component.
- **Presentational toast:** A fixed-position toast component (`AlertToast`) renders the current alert with a dismiss button, styled with Tailwind.
- **No new dependencies:** Uses React Context and Tailwind, both already in the project.

## Consequences

- Components can opt-in to global alerts without managing local error display state.
- Existing per-component error handling remains untouched; this is additive.
- The queue design supports future extensions (e.g. multiple simultaneous toasts, severity levels, adjustable durations) by modifying provider internals without changing the `useAlert` API.

## Alternatives considered

- **Per-component error state (status quo):** Inconsistent UX, easy to miss errors.
- **Third-party toast library (e.g. react-hot-toast):** Adds a dependency for a relatively simple feature; the project prefers minimal external dependencies.
- **Global event emitter instead of React Context:** Would require manual subscription management and doesn't integrate naturally with React's lifecycle.
