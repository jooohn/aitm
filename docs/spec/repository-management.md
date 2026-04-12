# Spec: Repository Management

**Status:** implemented
**Last updated:** 2026-04-12

## Summary

Repositories are defined in `~/.aitm/config.yaml` under a top-level `repositories` key. aitm reads them from the config file at runtime — no database storage. This keeps repository registration as plain-text config alongside workflow definitions, and removes the need for register/remove API endpoints.

## Requirements

### Config shape

```yaml
repositories:
  - path: /Users/alice/projects/myapp
  - path: /Users/alice/projects/another-app
```

| Field | Required | Description |
|---|---|---|
| `path` | yes | Absolute path to the repository root on disk |

`path` must be unique across all entries. The repository name displayed in the UI is derived from the last path component (e.g. `myapp`). The alias used in API routes is derived from the last two path components (e.g. `alice/myapp`) and must be unique across all configured repositories.

### Operations

#### List

- Read all entries from `repositories` in `~/.aitm/config.yaml`.
- Return them ordered by `path` ascending.
- If the config file does not exist or has no `repositories` key, return an empty list.

#### Validate

- Accept an alias or path.
- Check that the configured path still exists on disk and is a git repository (contains `.git`).
- Return `{ valid: boolean, reason?: string }`.
- Does not modify any data — read-only check.

### UI behavior

- The repository alias shown in the repository page sidebar header is `organization/name`.
- On narrow screens, long aliases must truncate within the sidebar header instead of widening the sidebar beyond the viewport.
- The GitHub link icon in that header remains visible and does not shrink away when the alias is truncated.

### Relationship to sessions

Sessions reference the repository by `path` (TEXT), not an integer ID. This replaces the `repository_id` INTEGER FK in the `sessions` table with a `repository_path` TEXT column. The path is the stable identity of a repository across config changes.

### API surface

| Method | Path | Operation |
|---|---|---|
| `GET` | `/api/repositories` | List |
| `GET` | `/api/repositories/:alias/validate` | Validate |

Register and remove are no longer API operations — users edit `~/.aitm/config.yaml` directly.

## Out of scope

- Remote repositories (SSH, HTTPS URLs)
- Scanning the filesystem to auto-discover repositories
- Authentication or multi-user support

## Decisions

- Repository identity is `path` (not an integer ID). Sessions reference it by path.
- No UI or API for adding/removing repositories — config file is the source of truth.
