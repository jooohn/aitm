# Spec: aitm config.yaml

**Status:** implemented
**Last updated:** 2026-03-29

## Summary

A global YAML configuration file at `~/.aitm/config.yaml` that defines the agent runtime and named workflows. A workflow is a directed graph of states where each state corresponds to an agent session. Users initiate a workflow run against a worktree; aitm advances through states automatically based on the configured agent's autonomous transition decisions.

## Requirements

### File location

- Path: `~/.aitm/config.yaml`
- Global — shared across all repositories and worktrees

### Repository list

Repositories are declared under a top-level `repositories` key:

```yaml
repositories:
  - path: /Users/alice/projects/myapp
  - path: /Users/alice/projects/another-app
```

See spec: repository-management.md for the full field reference.

### Agent runtime

The top-level `agent` block selects which CLI aitm launches for workflow states:

```yaml
agent:
  provider: claude # or codex
  model: sonnet
  command: claude
```

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | `claude` \| `codex` | no | Agent runtime to use. Defaults to `claude`. |
| `model` | string | no | Optional model name passed through to the configured runtime when supported. |
| `command` | string | no | Optional CLI executable path or command name. |

### Workflow definition

A workflow is a named directed graph with exactly one `initial_state` and at least one terminal transition.

```yaml
workflows:
  development-flow:
    initial_state: plan
    states:
      plan:
        goal: |
          Read the task goal. If the spec is ambiguous or missing, ask clarifying
          questions and document a clear plan in PLAN.md. Otherwise, document your
          understanding and proceed.
        transitions:
          - state: plan
            when: "specs need clarification or the plan is not yet documented"
          - state: implement
            when: "a clear plan is documented in PLAN.md"
          - terminal: failure
            when: "the task is out of scope or cannot be planned"

      implement:
        goal: |
          Implement the plan documented in PLAN.md. Write production-quality code.
        transitions:
          - state: implement
            when: "implementation is incomplete"
          - state: test
            when: "implementation is complete and ready for testing"
          - terminal: failure
            when: "implementation is blocked and cannot proceed"

      test:
        goal: |
          Run the test suite. Fix any failures. Ensure all tests pass.
        transitions:
          - state: implement
            when: "test failures reveal implementation issues"
          - state: review
            when: "all tests pass"
          - terminal: failure
            when: "tests cannot be fixed without reconsidering the plan"

      review:
        goal: |
          Review the diff. Check for correctness, style, and completeness.
          Request changes if needed.
        transitions:
          - state: implement
            when: "review found issues that require code changes"
          - state: commit
            when: "code is ready to commit"
          - terminal: failure
            when: "changes should be abandoned"

      commit:
        goal: |
          Stage all relevant changes and create a well-formed git commit.
        transitions:
          - state: push
            when: "commit was created successfully"
          - terminal: failure
            when: "commit could not be created"

      push:
        goal: |
          Push the branch to the remote repository.
        transitions:
          - terminal: success
            when: "push succeeded"
          - terminal: failure
            when: "push failed and cannot be resolved"
```

### State definition

Each state under `states` has:

| Field | Type | Required | Description |
|---|---|---|---|
| `goal` | string | yes | Fixed instruction string passed to the configured agent session as its objective |
| `transitions` | list | yes | Ordered list of transition candidates; the configured agent selects the first matching one |

### Transition definition

Each item in `transitions` is one of two forms:

**Next-state transition:**
```yaml
- state: <state-name>
  when: "<natural language condition>"
```

**Terminal transition:**
```yaml
- terminal: success | failure
  when: "<natural language condition>"
```

`when` is a natural language description of the condition. The configured agent evaluates all candidates and selects the appropriate one at the end of each session.

### Context handoff between states

When a session ends and a transition fires, the full history of all prior state executions is passed to the next session. Each entry contains:

1. **Summary** — a brief, agent-generated note of what was accomplished, key decisions made, and any artifacts produced (e.g. files created or modified)
2. **Log file reference** — path to that state's session log file

The next session receives its `goal` wrapped in `<goal>` tags, followed by a `<handoff>` block listing all prior states oldest-first. Log files are not loaded automatically; the session may read them if deeper context is needed. This design keeps each session's context window small while preserving a full audit trail.

### Initiating a workflow run

The user selects a workflow from the list of configured workflows and associates it with a worktree. The workflow starts at `initial_state` with no prior handoff context. The worktree's top-level objective (as specified when creating the worktree or session) is available to the first session.

### Terminal states

A terminal transition ends the workflow run for that worktree. The terminal value (`success` or `failure`) is recorded on the workflow run. The worktree itself remains open for the user to inspect, merge, or discard manually.

## Out of scope

- Per-repository config or overrides (global only for now)
- Templated goals with variable interpolation (fixed strings only for now)
- Human-in-the-loop / approval gate states (all states are agent sessions for now)
- Automatic worktree cleanup or merge on workflow completion

## Open questions

- How does a workflow run surface in the UI — as a top-level entity separate from individual sessions, or as a session group? → See spec: workflow-run.md

## Decisions

- **Handoff summary** is generated by the configured agent as a final step inside the session. The agent is explicitly instructed to emit a structured summary before concluding.
- **Transition evaluation** happens inside the session. The session is invoked with a constrained output schema `{transition, reason, handoff_summary}`; aitm reads this to advance the workflow run.
