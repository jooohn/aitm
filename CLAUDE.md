# CLAUDE.md

## Project Overview

aitm is a Next.js web UI for managing Claude Code tasks across git worktrees. It wraps the git-worktree-runner workflow, letting you create, monitor, review, and merge agent-driven coding tasks running in parallel — each isolated in its own worktree.

## Documentation: ADRs vs. Specs

**ADRs** (`docs/adr/${yyyymmdd}-${hhmmss}-${title}.md`, e.g. `docs/adr/20260328-140530-use-nextjs-for-frontend.md`) — record past decisions. Immutable; supersede instead of edit.

**Specs** (`docs/spec/title.md`) — describe future behavior before implementation. Freely editable until done.

**Rule of thumb:** Decision already made → ADR. Feature not yet built → Spec.

### ADR template

```markdown
# Title

**Date:** YYYY-MM-DD
**Status:** accepted

## Context
## Decision
## Consequences
## Alternatives considered
```

### Spec template

```markdown
# Spec: Title

**Status:** draft | ready | implemented | archived
**Last updated:** YYYY-MM-DD

## Summary
## Requirements
## Out of scope
## Open questions
```
