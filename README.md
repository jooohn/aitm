# aitm — AI Task Manager

A web-based GUI for managing coding-agent tasks across git repositories and git worktrees. aitm gives you a dashboard to create, monitor, review, and merge agent-driven coding tasks running in parallel — each isolated in its own worktree.

## Overview

aitm wraps the [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) workflow in a Next.js UI. Instead of manually juggling worktrees and terminal sessions, you get a single interface to:

- **Create tasks** — describe a coding task and spawn an agent to work on it in an isolated git worktree
- **Define multi-step workflows** — orchestrate agents through directed graphs of steps (plan → implement → test → review → commit → push)
- **Monitor progress** — watch agent activity in real time via a kanban board view across all running tasks
- **Review output** — inspect diffs and agent output before merging
- **Merge results** — integrate completed work back into your main branch

## Key Features

- **Multi-step workflows as directed graphs** — define workflows with steps and transitions in YAML; aitm advances through steps automatically based on agent transition decisions
- **Multiple agent runtimes** — supports Claude SDK and Codex SDK with per-step overrides for provider, model, and permission mode
- **Manual approval gates** — insert human-in-the-loop manual approval steps into workflows for review checkpoints
- **Workflow inputs** — parameterize workflow runs with typed input fields (text, multiline-text) defined in config
- **Read-only MCP resources** — expose aitm state over `/api/mcp` so external MCP clients can discover config, repositories, workflow runs, sessions, chats, and workflow artifacts
- **Real-time monitoring** — kanban board view groups workflow runs by status for at-a-glance progress tracking
- **Manual repository sync** — trigger a full house-keeping sweep from the header when you want to refresh all configured repositories immediately
- **User input mechanism** — agents can ask clarifying questions mid-session; the session pauses until the user replies
- **Re-run and retry** — re-run completed workflows or retry from a failed step without starting over
- **Multi-repository support** — manage tasks across multiple git repositories from a single dashboard
- **Command steps** — run shell commands as workflow steps with transition routing based on exit code

## Configuration

Workflows and repositories are defined in `~/.aitm/config.yaml`. See [docs/spec/aitm-config.md](docs/spec/aitm-config.md) for the full specification.

## Prerequisites

- [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) installed and configured
- Node.js (for running the Next.js app)
- Agent runtime credentials: [Claude](https://claude.ai/) API key (for Claude SDK runtime) or Codex CLI installed

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
- **Agent runtimes:** [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) (primary), [Codex SDK](https://github.com/openai/codex)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Logging:** [Pino](https://getpino.io/)
- **Worktree management:** [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner)
- **Testing:** [Vitest](https://vitest.dev/)
