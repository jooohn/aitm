# Spec: In-App Diff Review

**Status:** draft
**Last updated:** 2026-04-08

## Summary

Add a built-in diff viewer to aitm so users can review code changes made by agent steps directly in the UI, without leaving the application.

## Requirements

- **Diff API endpoint**: `GET /api/repositories/:organization/:name/worktrees/[...branch]/diff`
  - Runs `git diff main...HEAD` in the worktree directory to show changes relative to the base branch
  - Returns structured diff data: list of changed files, each with hunks containing added/removed/context lines
  - Supports query parameter `base` to override the base ref (defaults to `main`)
- **Diff viewer component**: Renders parsed diff data as a unified diff view
  - File list with expand/collapse per file
  - Line numbers for old and new sides
  - Syntax-aware coloring for added (green), removed (red), and context lines
- **Integration**: The diff viewer is accessible from the workflow run detail page via a "Review Changes" section
  - Uses the workflow run's `worktree_branch` and `repository_path` to fetch the diff
  - Shown when the workflow run has a worktree branch (always true)

## Out of scope

- Side-by-side diff view (unified only for v1)
- Inline commenting or annotation
- Syntax highlighting per language
- GitHub PR integration (Approach B from the plan)

## Open questions

- Should the diff auto-refresh while the workflow is running, or only on manual trigger?
