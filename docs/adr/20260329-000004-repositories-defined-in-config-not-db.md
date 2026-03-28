# Repositories defined in config file, not database

**Date:** 2026-03-29
**Status:** accepted

## Context

Repository registrations were originally stored in the SQLite database at `~/.aitm/aitm.db`, with a `repositories` table and CRUD API endpoints. Since `~/.aitm/config.yaml` was introduced as the home for workflow definitions, it is a natural fit for repository configuration as well — both are global, user-managed settings that describe how aitm should behave.

## Decision

Define repositories in `~/.aitm/config.yaml` under a top-level `repositories` key. aitm reads them at runtime; no database table or register/remove API endpoints. Sessions reference a repository by its `path` (TEXT) rather than an integer FK.

## Consequences

- Repository config lives alongside workflow config in one file — easier to audit and version-control externally.
- Adding or removing a repository is a text-editor operation, not a UI/API action. This is appropriate for a developer tool but would be a poor fit for a multi-user or non-technical audience.
- The `repositories` table in SQLite is no longer needed and will be removed.
- The `repository_id` INTEGER FK on the `sessions` table becomes `repository_path` TEXT, which is stable as long as the repository path on disk doesn't change. If a path changes, historical sessions lose their repository link (acceptable for a local dev tool).

## Alternatives considered

- **Keep DB storage, sync from config** — adds complexity (sync logic, conflict resolution) with no benefit over just reading the config directly.
- **Keep DB with UI-based registration** — appropriate for a product with non-technical users; over-engineered for a personal developer tool where the user is already editing YAML.
