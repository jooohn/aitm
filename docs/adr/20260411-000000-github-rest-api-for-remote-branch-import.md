# GitHub REST API for remote branch import

**Date:** 2026-04-11
**Status:** accepted

## Context

aitm creates worktrees from new branch names, but users also need to import existing remote branches — specifically branches that have open pull requests on GitHub — to run workflows on work started outside aitm (e.g., manually created PRs or PRs from other tools).

To populate the branch picker, the application needs to discover which remote branches have open PRs. This requires querying GitHub's API, which is aitm's first direct integration with an external web service.

## Decision

Use the GitHub REST API directly via native `fetch` to retrieve open pull requests and extract their head branch names. Specifically:

- **New service:** `GitHubBranchService` in `src/backend/domain/github/` calls `GET /repos/{owner}/{repo}/pulls?state=open` with a `GITHUB_TOKEN` environment variable for authentication.
- **No new dependencies:** Native `fetch` is sufficient for the single endpoint needed. No GitHub SDK (e.g., Octokit) is added.
- **Graceful degradation:** If `GITHUB_TOKEN` is not set or the API call fails, the service returns an empty array. The import feature is simply unavailable rather than erroring.
- **New API endpoint:** `GET /api/repositories/:organization/:name/remote-branches` exposes the filtered branch list to the frontend, following the existing route pattern and frontend/backend boundary rules.
- **Worktree creation reuse:** `gtr new <branch>` with `--track auto` already handles remote branches, so no changes to the worktree creation backend are needed.

## Consequences

- **New environment variable:** `GITHUB_TOKEN` is required for the import feature to function. Without it, the feature silently degrades (returns no branches).
- **GitHub-specific:** The implementation is coupled to GitHub's REST API. Supporting other Git hosting providers would require additional service implementations.
- **Rate limiting:** The GitHub API has rate limits (5,000 requests/hour for authenticated users). The current implementation fetches on-demand each time the user enters import mode, with no caching. This is acceptable for the expected usage patterns.
- **Pagination:** The endpoint fetches up to 100 open PRs (`per_page=100`). Repositories with more than 100 open PRs will see a truncated list.

## Alternatives considered

- **Octokit SDK:** Provides richer GitHub integration (pagination, rate-limit handling, typed responses) but adds a dependency for a single API call. Can be adopted later if more GitHub endpoints are needed.
- **`gh` CLI:** Shell out to `gh pr list` to avoid managing tokens directly. Rejected because it adds a CLI dependency and is harder to test. The app already requires `GITHUB_TOKEN` for a natural fit with `fetch`.
- **Git remote refs (`git ls-remote`):** Lists all remote branches without GitHub API access, but cannot filter to branches with open PRs, which is the core value of the feature.
