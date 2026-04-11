# Spec: Todos View

**Status:** implemented
**Last updated:** 2026-04-11

## Summary

The Todos view is a global inbox for workflow runs that need the user's
attention. It lists every run across all repositories whose status is
`awaiting` — i.e. paused on a manual-approval step or waiting for a
session's clarifying question — and lets the user drop straight into the
run detail to resolve it.

## Background

Manual-approval steps and session user-input requests both park a
workflow run in `awaiting` status (see `workflow-run.md` and
`session-management.md`). Without a global view, users had to browse each
repository's kanban board to find stalled runs. The Todos view is the
single "what is blocked on me" screen.

## Requirements

### Route

- `/todos` — list view. If at least one awaiting run exists, the layout
  auto-redirects to the first item (`/todos/:workflowRunId`) so the user
  always lands on a populated detail pane.
- `/todos/:workflowRunId` — detail pane. Renders the shared
  `WorkflowRunPage` component scoped under the `/todos/:id` base path so
  all nested links (session drawer, step executions) stay inside the
  todos layout.
- `/todos/:workflowRunId/@drawer/sessions/:sessionId` — parallel-route
  session drawer, mirroring the repository detail page pattern.

### Layout

Two-pane shell:

- **Left pane**: "Todo List" heading and a list of awaiting runs
  (`useAllWorkflowRuns("awaiting")`). Each row shows:
  - `StatusDot` with the `awaiting` variant
  - Worktree branch name
  - `organization/name` subtitle
  - Relative `updated_at` timestamp
  - Active row is highlighted when its URL matches the current pathname.
- **Right pane**: children (the selected run's detail, or an empty-state
  placeholder at `/todos`).

Loading and error states render in the list pane. Empty state shows "No
items are waiting for action."

### Data source

The list uses the existing
`GET /api/workflow-runs?status=awaiting` endpoint (via the
`useAllWorkflowRuns` SWR hook). Notifications from the
`workflow-run.status-changed` event automatically revalidate the list, so
as soon as a run enters or leaves the `awaiting` state elsewhere, the
todos list updates.

The detail pane reuses the shared `WorkflowRunPage` — the same component
rendered at `/repositories/:org/:name/workflow-runs/:id` — parameterized
with a `basePath` prop so inner links resolve under `/todos`.

## Out of scope

- Filtering or grouping by repository. The list is intentionally flat —
  an inbox, not a browser.
- Todos for things other than awaiting workflow runs (e.g. failed runs,
  process crashes). Those remain discoverable from their respective
  detail pages.
- Desktop notifications or badges on the browser tab.

## Decisions

- **Auto-redirect to first item.** Landing on `/todos` with a populated
  list and an empty right pane is annoying; the layout-level `useEffect`
  navigates to the first run so the user sees content immediately.
- **Reuse `WorkflowRunPage` with `basePath`.** Avoids duplicating the
  detail UI. The base path makes the component URL-location-agnostic.
