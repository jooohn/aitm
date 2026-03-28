# Spec: aitm config.yaml

**Status:** draft
**Last updated:** 2026-03-28

## Summary

A global YAML configuration file at `~/.aitm/config.yaml` that defines named workflows. A workflow is a directed graph of states where each state corresponds to a Claude Code session. Users initiate a workflow run against a worktree; aitm advances through states automatically based on Claude's autonomous transition decisions.

## Requirements

### File location

- Path: `~/.aitm/config.yaml`
- Global — shared across all repositories and worktrees

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
| `goal` | string | yes | Fixed instruction string passed to the Claude Code session as its objective |
| `transitions` | list | yes | Ordered list of transition candidates; Claude selects the first matching one |

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

`when` is a natural language description of the condition. Claude evaluates all candidates and selects the appropriate one at the end of each session.

### Context handoff between states

When a session ends and a transition fires, a structured handoff is passed to the next session. It contains:

1. **Summary** — a brief, Claude-generated note of what was accomplished, key decisions made, and any artifacts produced (e.g. files created or modified)
2. **Log file reference** — path to the previous session's log file

The next session receives its `goal` prepended with this handoff context. The log file is not loaded automatically; the session may read it if deeper context is needed. This design keeps each session's context window small while preserving a traceable audit trail.

### Initiating a workflow run

The user selects a workflow from the list of configured workflows and associates it with a worktree. The workflow starts at `initial_state` with no prior handoff context. The worktree's top-level objective (as specified when creating the worktree or session) is available to the first session.

### Terminal states

A terminal transition ends the workflow run for that worktree. The terminal value (`success` or `failure`) is recorded on the workflow run. The worktree itself remains open for the user to inspect, merge, or discard manually.

## Out of scope

- Per-repository config or overrides (global only for now)
- Templated goals with variable interpolation (fixed strings only for now)
- Human-in-the-loop / approval gate states (all states are Claude Code sessions for now)
- Automatic worktree cleanup or merge on workflow completion

## Open questions

- How does a workflow run surface in the UI — as a top-level entity separate from individual sessions, or as a session group? → See spec: workflow-run.md

## Decisions

- **Handoff summary** is generated by Claude as a final step inside the session. Claude is explicitly instructed to emit a structured summary before concluding.
- **Transition evaluation** happens inside the session. The session is invoked with the Agent SDK's `outputFormat` option to constrain Claude's final output to a validated schema `{transition, reason, handoff_summary}`; aitm reads this to advance the workflow run.
