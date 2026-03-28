# Global YAML config for workflow definitions

**Date:** 2026-03-29
**Status:** accepted

## Context

aitm needs a way to define named workflows — directed graphs of states that Claude Code sessions advance through. This configuration needs to live somewhere accessible to the aitm runtime.

## Decision

Store workflow definitions in a global YAML file at `~/.aitm/config.yaml`, shared across all repositories and worktrees.

## Consequences

- A single place to define and maintain workflows; no duplication across repositories.
- Workflows are user-defined and not version-controlled per project, which is appropriate since they describe the user's working style, not the project itself.
- If a team wants to share workflows, they must distribute the config file manually (no built-in sync mechanism).

## Alternatives considered

- **Per-repository config** (e.g. `.aitm/config.yaml` checked into each repo) — would allow per-project workflow customisation and version control, but most workflows (plan → implement → test → review → commit → push) are generic across projects. Can be revisited if per-project overrides become necessary.
- **Both global and per-repo with merging** — more flexible, but adds complexity before there is evidence of need.
- **Storing workflows in the database** — would allow UI-based editing, but sacrifices the ability to edit as plain text and version control the definitions externally.
