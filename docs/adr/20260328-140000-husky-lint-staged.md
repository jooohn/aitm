# Use Husky and lint-staged for Pre-commit Hooks

**Date:** 2026-03-28
**Status:** accepted

## Context

We wanted to enforce code quality checks automatically before commits, so that Biome lint and formatting issues are caught before they land in the repository rather than discovered later in CI or code review.

## Decision

Use **husky** to manage git hooks and **lint-staged** to run Biome checks only on staged files during pre-commit.

- `husky init` adds a `prepare` script to `package.json` that installs hooks on `npm install`
- `.husky/pre-commit` runs `npx lint-staged`
- `lint-staged` config in `package.json` runs `biome check --write` on staged `*.{ts,tsx,js,jsx,json}` files

## Consequences

- Commits are blocked if Biome finds unfixable issues (auto-fixable ones are fixed in place and re-staged)
- `npm install` automatically installs the hook for any contributor cloning the repo
- Adds husky and lint-staged as dev dependencies (~31 packages)

## Alternatives considered

- **simple-git-hooks**: Lighter alternative to husky with config in `package.json`. Rejected in favor of husky due to wider ecosystem familiarity.
- **Native `.git/hooks`**: Not committed to the repo, so each contributor would need to set up manually.
- **CI-only enforcement**: Would catch issues later in the workflow, after the commit is already made.
