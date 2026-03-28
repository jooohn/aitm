# Spec: Worktree Management

**Status:** draft
**Last updated:** 2026-03-28

## Summary

Worktrees are computed resources representing git worktree branches within a registered repository. They are not stored in aitm's database — they are read from and mutated via the `git gtr` CLI (git-worktree-runner). The UI provides a convenient interface to list, create, and remove worktrees, surfacing the output of the underlying CLI tool.

## Background

[git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) (`git gtr`) is a CLI wrapper around `git worktree` that manages isolated branch checkouts for parallel agent-driven development. Each worktree is an independent directory with a single branch checked out; multiple worktrees can exist per repository, allowing Claude Code agents to work in parallel.

## Requirements

### Data model

A worktree is a computed value derived from running `git gtr list` (or `git worktree list`) inside the registered repository path. No worktree data is persisted in SQLite.

| Field | Type | Source | Description |
|---|---|---|---|
| `branch` | string | git | Branch name checked out in this worktree |
| `path` | string | git | Absolute path to the worktree directory |
| `is_main` | boolean | derived | True if this is the primary worktree (the repo root itself) |
| `is_bare` | boolean | git | True if the worktree is a bare checkout |
| `head` | string | git | Current HEAD commit SHA (short) |

### Operations

#### List worktrees

- Accept a repository ID or alias.
- Run `git worktree list --porcelain` in the repository path to enumerate all worktrees.
- Parse and return the list of worktree records.
- The main worktree (repo root) is included in results, marked with `is_main: true`.
- Return an error if the repository path no longer exists or is not a git repo.

#### Create worktree

- Accept a repository ID or alias and a branch name.
- Run `git gtr new <branch>` in the repository path.
- If the branch does not exist remotely or locally, `git gtr` will create it from the configured base branch.
- Optional parameters:
  - `name` — custom worktree directory name (maps to `git gtr new <branch> --name <name>`)
  - `no_fetch` — skip fetching latest refs before creating (maps to `--no-fetch`)
- Return the newly created worktree record on success.
- Return a structured error if the branch already has a worktree and `--force` was not passed.

#### Remove worktree

- Accept a repository ID or alias and a branch name (or worktree path).
- Run `git gtr rm <branch>` in the repository path.
- Do not remove the main worktree.
- Return an error if the worktree does not exist or is the main worktree.
- Does not delete the branch from git — only the worktree checkout.

### API surface

All endpoints are scoped under a repository. The repository is identified by its alias (`organization/name`) matching the existing URL pattern.

| Method | Path | Operation |
|---|---|---|
| `GET` | `/api/repositories/:organization/:name/worktrees` | List |
| `POST` | `/api/repositories/:organization/:name/worktrees` | Create |
| `DELETE` | `/api/repositories/:organization/:name/worktrees/:branch` | Remove |

#### POST body (create)

```json
{
  "branch": "feat/my-feature",
  "name": "optional-custom-dir-name",
  "no_fetch": false
}
```

#### Response shape (single worktree)

```json
{
  "branch": "feat/my-feature",
  "path": "/Users/alice/project-feat-my-feature",
  "is_main": false,
  "is_bare": false,
  "head": "a1b2c3d"
}
```

### UI integration

The repository detail page (`/repositories/:organization/:name`) is extended to show a worktrees section:

- List all worktrees for the repository on page load.
- Each row shows: branch name, path, HEAD short SHA, and a Remove button (disabled for main worktree).
- A "New worktree" form accepts a branch name and submits the create operation.
- After create or remove, the list refreshes.

### Error handling

- If `git gtr` is not installed or not on `$PATH`, return a clear error: `"git-worktree-runner is not installed. Install it with: npm install -g @coderabbitai/git-worktree-runner"`.
- If the repository path is stale (deleted from disk), return a validation error pointing to the repository validate endpoint.
- CLI stderr is surfaced in the API response as `error.detail`.

## Out of scope

- Launching an AI agent or editor from the UI (e.g., `git gtr ai`, `git gtr editor`).
- Managing `git gtr` configuration (hooks, copy patterns, prefix).
- Merging or rebasing branches from the UI.
- Multi-worktree per branch (`--force` mode).
- Showing worktree status (dirty/clean working tree).

## Open questions

- Should list results include worktree dirty/clean status? Requires an extra `git status` call per worktree and could be slow.
- Should removing a worktree also offer to delete the branch? Could be a checkbox in the Remove confirmation.
- Should the API stream `git gtr` stdout for long-running create operations, or just block and return when done?
