# aitm — AI Task Manager

A web-based GUI for managing coding-agent tasks across git repositories and git worktrees. aitm gives you a dashboard to create, monitor, review, and merge agent-driven coding tasks running in parallel — each isolated in its own worktree.

## Overview

aitm wraps the [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) workflow in a Next.js UI. Instead of manually juggling worktrees and terminal sessions, you get a single interface to:

- **Create tasks** — describe a coding task and spawn a Claude Code or Codex agent to work on it in an isolated git worktree
- **Monitor progress** — watch agent activity in real time across all running tasks
- **Review output** — inspect diffs and agent output before merging
- **Merge results** — integrate completed work back into your main branch

## Prerequisites

- [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) installed and configured
- [Claude Code](https://claude.ai/code) CLI or Codex CLI installed
- Node.js (for running the Next.js app)
- A git repository to manage tasks against

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

Each task is backed by a git worktree — an isolated checkout of your repository. Your configured agent runtime runs inside that worktree, making changes without affecting your main branch. aitm tracks the lifecycle of each task from creation through review to merge.

```
main branch
  └── worktree/task-1  ← agent working here
  └── worktree/task-2  ← agent working here
  └── worktree/task-3  ← reviewing, ready to merge
```

## Tech Stack

- **Frontend:** [Next.js](https://nextjs.org/)
- **Agent runtime:** [Claude Code](https://claude.ai/code) or Codex CLI
- **Worktree management:** [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner)
