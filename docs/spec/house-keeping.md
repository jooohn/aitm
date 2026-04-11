# Spec: House-Keeping

**Status:** implemented
**Last updated:** 2026-04-11

## Summary

House-keeping is a periodic background task that keeps each configured
repository's worktrees, session data, and main branch in a tidy state
without user intervention. It runs on a timer after server startup,
operates one repository at a time, and broadcasts a syncing indicator
over the notifications stream so the UI can show progress.

## Scope

For each configured repository, a house-keeping sweep does four things
in order:

1. **Remove merged worktrees.**
   `WorktreeService.cleanMergedWorktrees(repoPath)` deletes worktrees
   whose branches have been merged upstream and are safe to remove.
   Removed branches are collected for step 3.
2. **Detect orphaned session data.**
   Compares the worktree branches that `SessionService` still has data
   for against the live worktree list from `WorktreeService`. Any branch
   with persisted session data but no live worktree is considered
   orphaned (e.g. the worktree was removed outside aitm).
3. **Delete session data for removed or orphaned branches.**
   Merges the branches from steps 1 and 2 and calls
   `SessionService.deleteWorktreeData(repoPath, branches)` to purge
   sessions, step executions, and logs tied to those branches.
4. **Pull main if outdated.**
   `WorktreeService.pullMainBranchIfOutdated(repoPath)` fast-forwards the
   repository's main branch when it is behind its upstream.

Each step is wrapped in its own try/catch: a failure in one step is
logged and does not block the remaining steps or subsequent repositories.

## Scheduling

- On startup, `startPeriodicHouseKeeping()` runs one sweep across all
  configured repositories immediately, then schedules further sweeps via
  `setInterval`.
- Interval defaults to 5 minutes. Override with the
  `AITM_HOUSE_KEEPING_INTERVAL_MS` environment variable (milliseconds).
- A single `isSyncing` flag prevents overlapping sweeps: if a sweep is
  still running when the timer fires, the new tick is skipped for every
  repository. This is a hard guard against concurrent file-system and
  git mutations.

## Syncing signal

`runHouseKeeping` wraps its work in `beginSync()` / `endSync()`, which
emit `house-keeping.sync-status-changed` on the event bus with
`{ syncing: true }` / `{ syncing: false }`. The notifications stream
forwards this event and also replays the latest value to any newly
connected client, so refreshing the page during a sweep still shows the
indicator. The `useHouseKeepingSyncing` hook consumes it to render a
global progress indicator.

## Out of scope

- Running house-keeping on demand from the UI. If needed, expose
  `runHouseKeeping` behind an admin endpoint later.
- Per-repository interval overrides. The single global interval is
  sufficient for a local single-user tool.
- Rebasing branches, pruning refs, garbage-collecting the repo, or any
  operation beyond the four steps above.
- House-keeping for chats or non-workflow resources — chats are
  self-cleaning via explicit close.

## Decisions

- **Sequential, not parallel.** Repositories are processed one at a time
  inside a single sweep. Parallelism would complicate the `isSyncing`
  guard and offer little benefit for a handful of local repos.
- **Log and continue on error.** Each sub-step is independent enough
  that a failure (e.g. a single repo has a stale lock) should not stop
  the rest of the sweep. Errors are surfaced via logs, not user-facing
  notifications, because they are usually transient.
- **Emit syncing status over the event bus** rather than exposing a
  polling endpoint, so the existing notifications stream is the single
  source of truth for "is something happening in the background".
