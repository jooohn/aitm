# Spec: Notifications Stream

**Status:** implemented
**Last updated:** 2026-04-11

## Summary

aitm pushes backend state changes to the browser through a single
Server-Sent Events (SSE) stream at `GET /api/notifications/stream`. The
frontend listens once, mirrors the events into the SWR cache as targeted
revalidations, and relies on SWR to refetch anything that actually changed.
There is no polling and no per-resource subscription.

## Background

Backend services emit domain events to an in-process `EventBus`
(`src/backend/infra/event-bus.ts`). A single SSE route subscribes to the
bus and re-broadcasts a curated subset of events as JSON notifications.
The frontend's root layout mounts `useNotificationRevalidation()`, which
opens the stream once and invalidates the relevant SWR keys whenever an
event arrives.

See ADR `20260405-100001-event-bus-for-inter-service-communication.md` for
the decision to centralize cross-service signalling on the event bus.

## Requirements

### Backend

#### Endpoint

- `GET /api/notifications/stream`
- Content type: `text/event-stream`
- Long-lived; no pagination. One connection per browser tab.
- On connect, the stream immediately replays the latest
  `house-keeping.sync-status-changed` payload if one is known, so late
  subscribers land in the correct steady state.
- Heartbeat comments are sent periodically to keep idle connections open
  through proxies.
- When the client disconnects, the route detaches all listeners from the
  event bus.

#### Event envelope

All events share the shape `{ type, payload }`, serialized as
`data: {...}\n\n`. The `NotificationEvent` union is published from
`@/shared/contracts/api` so frontend and backend share the type.

| `type` | Payload | Trigger |
|---|---|---|
| `house-keeping.sync-status-changed` | `{ syncing: boolean }` | House-keeping background sync starts or finishes |
| `workflow-run.status-changed` | `WorkflowRunContext & { status }` | A workflow run transitions status |
| `step-execution.status-changed` | `WorkflowRunContext & { stepExecutionId, status }` | A step execution transitions status |
| `worktree.changed` | `RepositoryContext` | A worktree is created, removed, or otherwise mutated |
| `process.status-changed` | `{ repositoryOrganization, repositoryName, worktreeBranch, processId, status }` | A long-running process under a worktree starts, stops, or crashes |

`RepositoryContext = { repositoryOrganization, repositoryName }` and
`WorkflowRunContext = RepositoryContext & { workflowRunId, branchName }`.

Event source of truth lives in `EventMap` in
`src/backend/infra/event-bus.ts`. Not every `EventMap` entry is forwarded
to the notifications stream — internal signals such as
`session.status-changed` and `agent-session.completed` are intentionally
omitted because the frontend does not need them.

### Frontend

#### Single shared stream

The stream is consumed by a hook pair in `src/lib/hooks/`:

- `useNotificationStream(onMessage)` — wraps `EventSource`, handles
  reconnection, and fans events out to subscribers.
- `useNotificationRevalidation()` — called once from the root layout.
  Buffers incoming events and maps each to a set of SWR key prefixes to
  invalidate via `mutate()`. This keeps revalidation in one place; page
  components never touch `EventSource` directly.

#### Key mapping

Each event type maps to one or more SWR key prefixes:

| Event | Revalidates |
|---|---|
| `workflow-run.status-changed` | The workflow run detail keys under its repository |
| `step-execution.status-changed` | The step execution keys under its workflow run |
| `worktree.changed` | The repository's worktree list and anything keyed under it (includes process lists) |
| `process.status-changed` | The worktree's processes list under its repository |
| `house-keeping.sync-status-changed` | Consumed by `useHouseKeepingSyncing` to render a global syncing indicator; not routed through SWR mutate |

Revalidation uses `populateCache: false` so that the mutate call only
marks entries stale without clobbering in-flight data.

## Out of scope

- Per-client filtering (every connected browser gets every event).
- Authenticated / multi-user scoping — aitm is a single-user local tool.
- Persisted event log or replay beyond the latest house-keeping status.
- WebSocket transport; SSE is sufficient for the one-way broadcast pattern.

## Decisions

- **One stream, not many.** A single SSE connection per tab avoids the
  fan-out of opening a stream per resource, and keeps the frontend wiring
  centralized in `useNotificationRevalidation`.
- **Forward a curated subset of `EventMap`.** Internal events that only
  matter inside the backend are not exposed to the browser, so the public
  contract in `@/shared/contracts/api` stays minimal.
- **Invalidate, don't push state.** Notifications never carry full
  resource payloads. SWR owns the cache; the stream only tells it what to
  refetch.
