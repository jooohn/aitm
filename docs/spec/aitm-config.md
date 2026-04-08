# Spec: aitm config.yaml

**Status:** implemented
**Last updated:** 2026-03-31

## Summary

A global YAML configuration file at `~/.aitm/config.yaml` that defines the agent runtime and named workflows. A workflow is a directed graph of steps where each step corresponds to an agent session. Users initiate a workflow run against a worktree; aitm advances through steps automatically based on the configured agent's autonomous transition decisions.

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

The top-level `agent` block selects which runtime aitm uses for workflow steps:

```yaml
agent:
  provider: claude # or codex
  model: sonnet
  permission_mode: edit
```

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | `claude` \| `codex` | no | Agent runtime to use. Defaults to `claude`. |
| `model` | string | no | Optional model name passed through to the configured runtime when supported. |
| `command` | string | no | Optional CLI executable path or command name. |
| `permission_mode` | `plan` \| `edit` \| `full` | no | Controls what the agent is allowed to do autonomously. Defaults to `edit`. `plan` = read-only, `edit` = can modify files, `full` = unrestricted. |

### Workflow definition

A workflow is a named directed graph with exactly one `initial_step` and at least one terminal transition. Workflows may optionally declare `inputs` for parameterized runs, plus `suggest_if` for context-aware follow-up workflows surfaced in the UI.

```yaml
workflows:
  development-flow:
    inputs:
      task_description:
        label: Task Description
        description: Describe the coding task to accomplish
        required: true
        type: multiline-text
      branch_name:
        label: Branch Name
        description: Name for the feature branch
        required: false
        type: text
    initial_step: plan
    steps:
      plan:
        goal: |
          Read the task goal. If the spec is ambiguous or missing, ask clarifying
          questions and document a clear plan in PLAN.md. Otherwise, document your
          understanding and proceed.
        transitions:
          - step: plan
            when: "specs need clarification or the plan is not yet documented"
          - step: implement
            when: "a clear plan is documented in PLAN.md"
          - terminal: failure
            when: "the task is out of scope or cannot be planned"

      implement:
        goal: |
          Implement the plan documented in PLAN.md. Write production-quality code.
        transitions:
          - step: implement
            when: "implementation is incomplete"
          - step: test
            when: "implementation is complete and ready for testing"
          - terminal: failure
            when: "implementation is blocked and cannot proceed"

      test:
        goal: |
          Run the test suite. Fix any failures. Ensure all tests pass.
        transitions:
          - step: implement
            when: "test failures reveal implementation issues"
          - step: review
            when: "all tests pass"
          - terminal: failure
            when: "tests cannot be fixed without reconsidering the plan"

      review:
        goal: |
          Review the diff. Check for correctness, style, and completeness.
          Request changes if needed.
        transitions:
          - step: implement
            when: "review found issues that require code changes"
          - step: commit
            when: "code is ready to commit"
          - terminal: failure
            when: "changes should be abandoned"

  maintain-pr:
    suggest_if:
      label: Maintain PR
      when: $.run.metadata.presets__pull_request_url
      inputs:
        pr-url: $.run.metadata.presets__pull_request_url
        source-run-id: $.run.id
    inputs:
      pr-url:
        label: Pull Request URL
        required: true

      commit:
        goal: |
          Stage all relevant changes and create a well-formed git commit.
        transitions:
          - step: push
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

### Workflow inputs

Workflows can declare typed input fields under an `inputs` key. When a user initiates a workflow run, they are prompted to fill in these fields.

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | string | yes | Display label shown in the UI |
| `description` | string | no | Help text describing what the input is for |
| `required` | boolean | no | Whether the field must be filled. Defaults to `false`. |
| `type` | `text` \| `multiline-text` | no | Input field type. Defaults to `text`. |

Input values are validated at run creation (required fields must be non-empty) and passed to agents in the step goal wrapped in `<inputs>` tags.

### Step definition

Each step under `steps` is one of:

1. A goal-based step with `goal` and `transitions`
2. A command-based step with `command` and `transitions`
3. A manual approval step with `type: manual-approval` and `transitions`

Goal-based steps have:

| Field | Type | Required | Description |
|---|---|---|---|
| `goal` | string | yes | Fixed instruction string passed to the configured agent session as its objective |
| `transitions` | list | yes | Ordered list of transition candidates; the configured agent selects the first matching one |

Goal-based steps may also define an optional `agent` block that overrides the top-level runtime for that step only:

```yaml
agent:
  provider: claude
  model: sonnet

workflows:
  development-flow:
    initial_step: plan
    steps:
      plan:
        goal: Write a plan
        agent:
          provider: codex
          model: gpt-5.4
        transitions:
          - step: implement
            when: plan is ready

      implement:
        goal: Implement the plan
        agent:
          model: sonnet-4.5
        transitions:
          - terminal: success
            when: done
```

Step-level `agent` fields use shallow inheritance from the top-level `agent` config:

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | `claude` \| `codex` | no | Optional. If omitted, the step inherits the top-level provider. |
| `model` | string | no | Optional. Overrides the model for that step only. |
| `command` | string | no | Optional. Overrides the CLI executable path or command name for that step only. |

Command-based steps do not use `agent` config. If `provider` is omitted in a goal-step override, only the supplied fields are replaced and the remaining fields continue to inherit from the top-level `agent` block.

### Command-based steps

A command step runs a shell command instead of an agent session:

```yaml
steps:
  run-tests:
    type: command
    command: npm test
    transitions:
      - step: review
        when: "command exited successfully"
      - step: implement
        when: "command failed"
```

The `command` string is executed via `sh -c` in the worktree directory. Stdout and stderr are captured and stored as `command_output` on the step execution. The transition is selected based on exit code (success = exit 0, failure = non-zero).

### Manual approval steps

A manual approval step pauses the workflow until a human approves or rejects:

```yaml
steps:
  approve-deploy:
    type: manual-approval
    transitions:
      - step: deploy
        when: "approved"
      - terminal: failure
        when: "rejected"
```

When a manual approval step is reached, the workflow run enters `awaiting` status. The user reviews the work and resolves the approval via the API with an approve/reject decision and optional reason.

### Output configuration

Goal-based steps can declare an `output` block to extract structured metadata from the agent's final output:

```yaml
steps:
  push:
    goal: Push the branch and create a pull request
    output:
      presets:
        - pull_request_url
      metadata:
        summary:
          type: string
          description: A brief summary of the changes
    transitions:
      - terminal: success
        when: "push succeeded"
```

| Field | Type | Description |
|---|---|---|
| `output.presets` | string[] | Named preset metadata fields (e.g. `pull_request_url`) |
| `output.metadata` | Record\<string, { type, description? }\> | Custom metadata fields the agent should extract |

Presets are resolved from a built-in registry and merged with explicit metadata fields. Extracted metadata is accumulated on the workflow run's `metadata` JSON field.

### Transition definition

Each item in `transitions` is one of two forms:

**Next-step transition:**
```yaml
- step: <step-name>
  when: "<natural language condition>"
```

**Terminal transition:**
```yaml
- terminal: success | failure
  when: "<natural language condition>"
```

`when` is a natural language description of the condition. The configured agent evaluates all candidates and selects the appropriate one at the end of each session.

### Context handoff between steps

When a session ends and a transition fires, the full history of all prior step executions is passed to the next session. Each entry contains:

1. **Summary** — a brief, agent-generated note of what was accomplished, key decisions made, and any artifacts produced (e.g. files created or modified)
2. **Log file reference** — path to that step's session log file

The next session receives its `goal` wrapped in `<goal>` tags, followed by a `<handoff>` block listing all prior steps oldest-first. Log files are not loaded automatically; the session may read them if deeper context is needed. This design keeps each session's context window small while preserving a full audit trail.

### Initiating a workflow run

The user selects a workflow from the list of configured workflows and associates it with a worktree. The workflow starts at `initial_step` with no prior handoff context. The worktree's top-level objective (as specified when creating the worktree or session) is available to the first session.

### Terminal steps

A terminal transition ends the workflow run for that worktree. The terminal value (`success` or `failure`) is recorded on the workflow run. The worktree itself remains open for the user to inspect, merge, or discard manually.

## Out of scope

- Per-repository config or overrides (global only for now)
- Templated goals with variable interpolation (fixed strings only for now)
- Automatic worktree cleanup or merge on workflow completion

## Open questions

- How does a workflow run surface in the UI — as a top-level entity separate from individual sessions, or as a session group? → See spec: workflow-run.md

## Decisions

- **Handoff summary** is generated by the configured agent as a final step inside the session. The agent is explicitly instructed to emit a structured summary before concluding.
- **Transition evaluation** happens inside the session. The session is invoked with a constrained output schema `{transition, reason, handoff_summary}`; aitm reads this to advance the workflow run.
