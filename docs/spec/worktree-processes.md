# Spec: Worktree Process Management UI

**Status:** draft
**Last updated:** 2026-04-10

## Summary

Give users a UI for launching, observing, and stopping long-running shell
processes (e.g. dev server, test watcher) inside a worktree. Processes are
independent of workflow runs — they are auxiliary background tasks that
support manual exploration and agent-driven work happening in the same
worktree.

Backend support already exists: `ProcessService` with in-memory tracking,
REST endpoints under `/api/repositories/:org/:name/worktrees/:branch/processes`,
an SSE output stream, and notification events on `process.status-changed`.
Commands are pre-configured per repository in `~/.aitm/config.yaml` as a
map keyed by a stable id.

This spec covers only the frontend.

## Requirements

### Processes section on the worktree detail page

A new section on `/repositories/:org/:name/worktrees/:branch` lists and
controls processes for that worktree.

Layout (rendered below the existing workflow kanban board):

- Section heading: "Processes"
- **Launchers row**: one button per command configured for the repository.
  The button label matches the command's `label`. Clicking the button POSTs
  `{ command_id }` to the processes endpoint and the new process appears in
  the list.
- If no commands are configured for the repository, the entire Processes
  section is hidden.
- **Process list**: each process row shows
  - status dot (running / stopped / crashed)
  - command label
  - shell command in muted monospace
  - started-at timestamp (relative, e.g. "3m ago")
  - exit code when the process has terminated
  - a link (the whole row) opening the process drawer
  - a stop button (only while running)

Processes are listed newest-first. Terminated processes remain in the list
until the page is refreshed or the worktree is removed (the in-memory
`ProcessService` cleans up with the worktree).

### Process output drawer (right-side, URL-addressable)

Opening a process from anywhere in the app navigates to
`/repositories/:org/:name/worktrees/:branch/processes/:processId` which
renders a right-side drawer using Next.js parallel routes (`@drawer` slot),
mirroring the existing `SessionDrawer` pattern.

Drawer contents:

- **Header**: command label, status dot, stop button (when running),
  close button
- **Meta row**: shell command, pid, exit code (when applicable), started /
  stopped timestamps
- **Output**: terminal-style monospace view (dark background, wrap off,
  horizontal scroll). Lines stream in from
  `GET /api/.../processes/:processId/output` (SSE). The view auto-scrolls
  to the bottom as new lines arrive, unless the user has scrolled up.
- **Done signal**: when the SSE stream emits `event: done`, the drawer stops
  listening and reflects the terminal status.

Closing the drawer (backdrop click, close button, Escape) navigates back to
the parent URL (worktree detail).

Because the drawer route is URL-based, the same drawer can be opened from
other surfaces later (e.g. a global "Running processes" menu) without
refactoring.

### Real-time updates

The existing notification stream already emits `process.status-changed`
events with repository context, and `useNotificationRevalidation` already
revalidates the repository's worktree URL prefix. The processes SWR key
(`swrKeys.processes(org, name, branch)`) sits under that prefix, so the
list updates automatically when a process starts, stops, or crashes.

The drawer relies on the SSE stream directly for output; it does not need
SWR revalidation for output, but it uses `useProcess(id)` for status/meta.

### Sidebar indicator (phase 2)

Next to each worktree in the left sidebar, show a small badge / colored dot
when that worktree has ≥1 running process. Aggregate status: any running →
active; any crashed and none running → error; otherwise → hidden. No
controls in the sidebar — users click through to the worktree detail page
to manage processes.

This piece is optional for the first cut and should be added after the
detail-page flow is validated.

## Out of scope

- Persisted process history across server restarts (processes are
  in-memory)
- Ad-hoc shell commands from the UI (only pre-configured commands; enforced
  server-side)
- Multi-line search / grep over output (future work if needed)
- Restarting a terminated process in place (user relaunches from the
  command button)
- Wiring processes into workflow runs (these remain independent concepts)

## Open questions

- Should terminated processes auto-clear after some time, or only on
  explicit user action? → Default: keep them visible until worktree unload;
  revisit if the list grows.
- Should we surface process output inline on the detail page as a
  collapsible terminal, in addition to the drawer? → Deferred; drawer is
  sufficient for first cut.
