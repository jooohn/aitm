# Error propagation and gh CLI fallback for remote branch import

**Date:** 2026-04-11
**Status:** accepted
**Supersedes:** 20260411-000000-github-rest-api-for-remote-branch-import.md (partially — error handling and gh CLI sections)

## Context

The initial remote branch import implementation (see superseded ADR) silently returned an empty array on every failure path: missing token, API errors, and network errors. This made it impossible for users to distinguish "no open PRs" from "something went wrong." The feature was also unusable without configuring a `GITHUB_TOKEN` environment variable, even when the user had the `gh` CLI authenticated locally.

## Decision

### Errors propagate instead of silent degradation

`GitHubBranchService.fetchBranchesWithOpenPRs()` now throws on failure instead of returning `[]`:

- **API response not OK:** throws with HTTP status and response body.
- **Network/fetch exception:** propagates to the caller.
- **No authentication available:** throws indicating neither token nor `gh` CLI is available.

The API route's existing `catch` block converts thrown errors into proper HTTP error responses (400, 500). The frontend catches these and displays the error message to the user.

### gh CLI as fallback when GITHUB_TOKEN is unset

When `GITHUB_TOKEN` is not set, the service falls back to `gh pr list --repo {owner}/{repo} --state open --json number,title,headRefName --limit 100` and parses the JSON output. This uses the `gh` CLI's own authentication (`gh auth login`), requiring no additional token configuration.

`spawnAsync` is injected via the constructor, consistent with how other services receive process-spawning capabilities (e.g., `WorktreeService`, `RepositoryService`).

## Consequences

- **`GITHUB_TOKEN` is now optional:** Users with `gh` CLI authenticated locally can use the import feature without setting any environment variable.
- **Errors are visible:** Users see specific error messages when the feature fails, rather than an empty branch list.
- **`gh` CLI dependency:** The fallback path requires the `gh` CLI to be installed and authenticated. This is a soft dependency — the feature works without it if `GITHUB_TOKEN` is set.
- **All other aspects of the original ADR remain unchanged:** REST API via native `fetch`, no Octokit, same API route pattern, same pagination limits.

## Alternatives considered

- **Keep silent degradation:** Simpler but poor UX — users cannot diagnose configuration problems.
- **Require `gh` CLI always (no token path):** Would simplify the code to a single path, but `GITHUB_TOKEN` is more portable for server/CI environments where `gh` may not be installed.
