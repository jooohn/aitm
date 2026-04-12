# Spec: Read-only MCP Resources

**Status:** implemented
**Last updated:** 2026-04-12

## Summary

aitm exposes a read-only Model Context Protocol surface at `/api/mcp` so MCP
clients can inspect local aitm state without going through the web UI or
adding a separate write/control plane. The first pass is intentionally narrow:
resource discovery and resource reads only.

The adapter publishes stable `aitm://...` URIs for configuration, repositories,
worktrees, workflows, workflow runs, workflow-run artifacts, sessions, and
planning chats. It reuses existing backend services and shared DTO serializers
instead of introducing MCP-specific domain models.

## Requirements

### Transport

- Serve MCP over `POST /api/mcp`.
- Reject `GET /api/mcp` and `DELETE /api/mcp` with `405 Method Not Allowed`.
- Use the MCP Streamable HTTP transport in stateless JSON-response mode for
  this first pass.
- Keep the route read-only: no MCP tools, prompts, or mutation endpoints.

### Resource set

The first-pass resource list is:

- `aitm://config/snapshot`
- `aitm://repositories`
- `aitm://repositories/{organization}/{name}`
- `aitm://repositories/{organization}/{name}/worktrees`
- `aitm://workflows`
- `aitm://workflows/{workflow_name}`
- `aitm://workflow-runs`
- `aitm://workflow-runs/{workflow_run_id}`
- `aitm://workflow-runs/{workflow_run_id}/artifacts`
- `aitm://workflow-runs/{workflow_run_id}/artifacts/{artifact_path}`
- `aitm://sessions`
- `aitm://sessions/{session_id}`
- `aitm://chats`
- `aitm://chats/{chat_id}`

Resources are listed in URI-sorted order so focused tests can assert on a
stable contract.

### Payloads

- JSON resources should reuse existing API DTO shapes where practical.
- Repository detail includes the resolved GitHub URL and configured commands.
- Artifact index resources return declared artifacts with `exists`, `uri`,
  `mimeType`, and optional `description`.
- Artifact file resources return UTF-8 text for text-like MIME types and base64
  blobs for binary content.
- Zero-byte artifacts still count as existing readable resources.
- If a workflow run's worktree cannot be resolved, the adapter must still list
  the run and its declared artifacts as `exists: false` rather than failing the
  entire MCP resource listing.

### Backend structure

- Keep MCP-specific code under `src/backend/mcp/`.
- Reuse existing services for data access:
  `RepositoryService`, `WorktreeService`, `WorkflowRunService`,
  `SessionService`, and `ChatService`.
- Reuse shared serializers from `src/backend/api/dto.ts` where they already
  define the public read shape.

## API surface

| Method | Path | Operation |
|---|---|---|
| `POST` | `/api/mcp` | MCP initialize, `resources/list`, and `resources/read` |
| `GET` | `/api/mcp` | Reject with `405` in the stateless first pass |
| `DELETE` | `/api/mcp` | Reject with `405` in the stateless first pass |

## Runtime wiring

aitm uses the same read-only MCP surface in two places:

- External MCP clients connect over `POST /api/mcp`.
- Launched Claude SDK sessions use an in-process MCP server attachment.
- Launched Codex SDK sessions and planning chats receive a runtime config
  override that points their MCP client to `http://127.0.0.1:<PORT>/api/mcp`
  by default, or `AITM_MCP_SERVER_URL` when explicitly set.

This keeps the resource contract identical across external MCP consumers and
aitm-managed agents without duplicating adapter logic.

## Out of scope

- MCP mutation tools
- Streaming SSE session management for MCP clients
- Remote exposure or a stronger auth model
- Process resources and other highly ephemeral runtime state
