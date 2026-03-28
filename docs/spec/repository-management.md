# Spec: Repository Management

**Status:** implemented
**Last updated:** 2026-03-28

## Summary

Allow users to register local git repositories with aitm so they can be used as targets for agent-driven tasks. Registrations are persisted in a local SQLite database. Each registered repository tracks the path on disk.

## Requirements

### Data model

A `repositories` table in SQLite:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal ID |
| `path` | TEXT | NOT NULL, UNIQUE | Absolute path to the repository root |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |

### Operations

#### Register (add)

- Accept an absolute path to a local directory.
- Validate that the path exists and is a git repository (contains `.git`).
- Reject duplicate paths (return a clear error, not a silent upsert).
- Return the created repository record.

#### List

- Return all registered repositories ordered by `path` ascending.
- Each record includes all columns.
- No filtering or pagination required initially.

#### Remove

- Accept an `id`.
- Delete the repository record.
- Do not touch the filesystem — only remove the registration.
- Return an error if the ID does not exist.

#### Validate

- Accept an `id` or a path.
- Check that the registered path still exists on disk and is a git repository.
- Return a validation result: `{ valid: boolean, reason?: string }`.
- Reasons for invalid: path does not exist, path is not a git repository.
- Does not modify any data — read-only check.

### Database location

SQLite file stored at `~/.aitm/aitm.db`. The directory is created on first use if it does not exist.

### API surface (backend-first)

The backend exposes these operations as plain functions/classes first. REST or RPC endpoints follow the same shape — one endpoint per operation:

| Method | Path | Operation |
|---|---|---|
| `POST` | `/api/repositories` | Register |
| `GET` | `/api/repositories` | List |
| `DELETE` | `/api/repositories/:id` | Remove |
| `GET` | `/api/repositories/:id/validate` | Validate |

## Out of scope

- Remote repositories (SSH, HTTPS URLs).
- Editing a registration after creation — remove and re-add instead.
- Scanning the filesystem to auto-discover repositories.
- Authentication or multi-user support.

## Open questions

- Should `validate` be called automatically on list, or only on demand?
- Should removing a repository also clean up associated tasks/worktrees, or just the registration?
