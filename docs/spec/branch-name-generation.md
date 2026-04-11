# Spec: Branch Name Generation

**Status:** implemented
**Last updated:** 2026-04-11

## Summary

aitm proposes a worktree branch name whenever the user launches a workflow
run or approves a planning-assistant proposal. Generation is a pure,
deterministic-ish function of the workflow name and its inputs, performed
on the backend so the same rules apply everywhere (UI forms, chat
proposals, tests).

## Requirements

### Algorithm

`BranchNameService.generate(workflowName, inputs)` returns a string in the
shape `<prefix>/<slug>-<suffix>`.

1. **Prefix**: looked up from a static workflow-name → prefix table.
   Known entries:
   - `development-flow` → `feat`
   - `bugfix-flow` → `fix`
   - `refactor-flow` → `refactor`
   - Any other workflow name → `task`
2. **Slug**: derived from the first non-empty value in `inputs` (iteration
   order matches `Object.values`). The value is slugified:
   - lowercased
   - non-alphanumeric/whitespace/hyphen characters dropped
   - whitespace and hyphen runs collapsed to a single `-`
   - leading/trailing `-` trimmed
   - truncated so the full branch name fits within `MAX_LENGTH` (50)
3. **Suffix**: 4 hex characters from `crypto.randomBytes`, always appended.
   The suffix gives uniqueness when two runs share the same slug; it is
   not intended as a security token.
4. **Fallback**: if no input value is non-empty, the slug portion is
   replaced with the current Unix timestamp so the result is still unique
   (`<prefix>/<timestamp>-<suffix>`).

### API

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/branch-name/generate` | `{ workflow_name: string, inputs?: Record<string,string> }` | `{ branch: string }` |

The endpoint validates the body through `branchNameGenerateBodySchema`
and returns a standard error response on validation failure.

### Callers

- The "Run Workflow" modal fetches a proposed branch name after the user
  fills in the workflow inputs, and lets them edit it before submitting.
- `ChatService.approveProposal` (planning assistant) calls the same
  service to mint a branch name before creating the worktree.

## Out of scope

- Collision detection against existing worktrees. The random suffix makes
  collisions vanishingly rare; the worktree service will reject a genuine
  collision and the user can retry.
- LLM-based name generation. The current heuristic is cheap, fast, and
  predictable; an LLM round-trip would add latency without meaningful UX
  gain for a short, editable field.
- Per-repository prefix customization. If needed, this should migrate the
  prefix table into `~/.aitm/config.yaml`.

## Decisions

- **Backend-only generation.** Keeping the logic on the server means the
  UI, the planning assistant, and tests all go through one code path and
  cannot drift.
- **Random suffix always appended.** Simpler than conditionally
  suffixing; keeps output length predictable and avoids collision checks.
