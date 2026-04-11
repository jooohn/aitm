# Spec: Planning Assistant

**Status:** implemented
**Last updated:** 2026-04-11

## Summary

A conversational assistant that helps users brainstorm, explore, and create workflow-runs. Users interact via a chat interface scoped to a repository. The assistant can read the codebase (on the main branch), discuss ideas, and propose workflow-runs for the user to approve — at which point the system creates the worktree and launches the workflow.

## Requirements

### Chat model (new domain entity)

The existing `Session` is tightly coupled to the workflow state machine — it carries `step_execution_id`, `transitions`, `transition_decision`, `metadata_fields`, and its repository/service layers join against `step_executions` and `workflow_runs`. Rather than overloading `Session` with nullable fields and conditional logic, introduce a new `Chat` entity.

```typescript
interface Chat {
  id: string;
  repository_path: string;       // which repo this chat is about
  title: string | null;          // auto-generated or user-provided; nullable initially
  status: ChatStatus;            // "running" | "awaiting_input" | "idle" | "failed"
  agent_config: AgentConfig;
  log_file_path: string;         // same log format as sessions — reuse SSE streaming
  claude_session_id: string | null;
  created_at: string;
  updated_at: string;
}

type ChatStatus = "running" | "awaiting_input" | "idle" | "failed";
```

Key differences from `Session`:
- No `transitions`, `transition_decision`, `step_execution_id`, `workflow_run_id`, `metadata_fields`, `step_name`, `worktree_branch`, or `goal`.
- Has `title` for display in the sidebar.
- Status includes `"idle"` — the chat is not running but can be resumed with a new message. Sessions go from running to a terminal state; chats are long-lived conversations.
- No event bus integration for workflow state machine advancement.

### Chat lifecycle

1. **Create**: User clicks "New Chat" in the sidebar. A `Chat` record is created with status `"idle"` and no agent session yet. The user is navigated to the chat view.
2. **First message**: User types a message. The system starts the agent (via `AgentRuntime.query`) with the message as the prompt. Status becomes `"running"`.
3. **Agent responds**: The agent streams its response (logged to file, streamed via SSE). When the agent finishes, the system inspects the structured output:
   - If `proposals` is non-empty — status becomes `"awaiting_input"`, proposals are surfaced in the UI.
   - If `proposals` is empty — status returns to `"idle"`. The conversation is open for the next user message.
4. **Subsequent messages**: User types another message (or acts on proposals). The system calls `AgentRuntime.resume` with the `claude_session_id`. Status becomes `"running"` again.
5. **Close**: User explicitly closes the chat. The system deletes the DB row and log file.
6. **Failure**: If the agent crashes, status becomes `"failed"`. The user can still close the chat.

### ChatService

A new service that manages the chat lifecycle. It talks to `AgentRuntime` directly — it does **not** go through `AgentService`, which is workflow-specific.

```typescript
interface WorkflowRunProposal {
  workflow_name: string;
  inputs: Record<string, string>;
  rationale: string;
}

class ChatService {
  constructor(
    private chatRepository: ChatRepository,
    private runtimes: Record<AgentProvider, AgentRuntime>,
    private worktreeService: WorktreeService,
    private workflowRunService: WorkflowRunService,
    private defaultAgentConfig: AgentConfig,
  ) {}

  createChat(repositoryPath: string): Chat;
  getChat(id: string): Chat | undefined;
  listChats(repositoryPath?: string): Chat[];
  closeChat(id: string): void;  // deletes DB row + log file

  // Start or resume the agent with a user message
  sendMessage(chatId: string, message: string): Promise<void>;

  // Handle proposal approval — creates worktree + workflow-run, resumes agent
  approveProposal(
    chatId: string,
    proposalId: string,
    overrides?: { workflow_name?: string; inputs?: Record<string, string> },
  ): Promise<WorkflowRun>;

  // Handle proposal rejection — resumes agent with rejection context
  rejectProposal(chatId: string, proposalId: string, reason?: string): Promise<void>;
}
```

`ChatService` reuses the same `AgentRuntime` instances (ClaudeSDK/CodexSDK) and the same log-file + SSE streaming infrastructure.

### Agent configuration

- The agent runs with a **read-only tool set**: `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `LSP`, `Agent` (sub-agent), `ToolSearch`, `ListMcpResourcesTool`, `ReadMcpResourceTool`. No `Bash`, `Write`, `Edit`, `TodoWrite`, `Skill`, `SendMessage`, `TeamCreate`, or `TeamDelete`.
- The agent's `cwd` is the `repository_path` (the repo root on the main branch).
- Permission mode: read-only to enforce no-write at the runtime level.
- The agent uses the same base LLM configured for the system (no per-repo override for now).

### Structured output

The chat agent uses structured output **only** for proposals. Every agent turn ends with:

```json
{
  "proposals": []
}
```

Or, when the agent wants to suggest workflow-runs:

```json
{
  "proposals": [
    {
      "workflow_name": "development-flow",
      "inputs": { "task": "Add input validation to all API route handlers" },
      "rationale": "API routes currently accept unvalidated input, risking runtime errors and potential security issues."
    },
    {
      "workflow_name": "development-flow",
      "inputs": { "task": "Add React error boundaries to page-level components" },
      "rationale": "Unhandled component errors currently crash the entire app. Error boundaries would isolate failures."
    }
  ]
}
```

The schema passed to `AgentRuntime`:

```typescript
const CHAT_OUTPUT_FORMAT: OutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            workflow_name: { type: "string" },
            inputs: { type: "object" },
            rationale: { type: "string" },
          },
          required: ["workflow_name", "inputs", "rationale"],
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  },
};
```

The agent's conversational content (explanations, analysis, questions) is delivered through its normal streamed messages (text blocks, tool calls). The structured output is purely a machine-readable signal for proposals. The system prompt instructs the agent:

- Always emit the structured output at the end of each turn.
- Include proposals only when you have concrete, actionable suggestions for workflow-runs.
- Emit `"proposals": []` for normal conversational turns (answering questions, exploring code, discussing ideas).
- Available workflows and their input schemas are provided in the system prompt so the agent knows what it can propose.

### Status transitions

```
idle ──sendMessage──→ running ──agent finishes (proposals=[])──→ idle
                         │
                         └──agent finishes (proposals.length > 0)──→ awaiting_input
                                                                         │
                         ┌──────────────────────────────────────────────────┘
                         │
                  approve/reject ──→ running ──→ idle / awaiting_input
                         │
                    (user can also sendMessage from awaiting_input)

idle/awaiting_input/failed ──closeChat──→ (deleted)

running ──agent crashes──→ failed
```

### User confirmation flow

When proposals are surfaced in the UI, the user can act on **each proposal independently**:
- **Approve** — the system creates a worktree (auto-generated branch name) and launches the workflow-run. The chat resumes with a message confirming the created run (including a link to the workflow-run page).
- **Approve with edits** — opens the existing `RunWorkflowModal` pre-filled with the proposed `workflow_name` and `inputs`. On modal submission, the chat resumes with a confirmation.
- **Reject** — the chat resumes with a message indicating the user declined that specific proposal.

Each proposal is assigned a **server-generated UUID** when the system receives the agent's structured output. This ID is used for the approve/reject API calls, avoiding fragile array-index references.

The user does **not** need to act on all proposals before continuing. They can approve or reject individual proposals at any time, or ignore pending proposals entirely and send a new message to continue the conversation. Approving/rejecting a proposal resumes the agent with context about that action. Sending a free-text message also resumes the agent (pending unresolved proposals remain visible in the UI but become stale — the user can still act on them later or ignore them).

### UI

#### Sidebar

- Add a "New Chat" button in the repository sidebar, below the existing "Run Workflow" button.
- Below the button, list past chats for this repository (most recent first), showing the chat title (or a truncated first message if no title yet). Chats with `"running"` or `"awaiting_input"` status get a visual indicator.
- Each chat entry has a close/delete action.

#### Chat view

- Route: `/repositories/[org]/[name]/chat/[chatId]`
- Renders in the repository layout's main content area.
- Reuses the existing session stream components:
  - SSE connection to `/api/chats/[id]/stream` (same log format).
  - Message rendering (assistant text, tool calls, etc.).
  - Message input at the bottom — always visible, since chats are open-ended. Disabled only while status is `"running"`.
- **Proposal Cards**: When the agent emits proposals (detected from the structured output `result` message in the log stream), render a card for each proposal inline in the message stream:
  - Shows workflow name, input values, rationale.
  - Approve / Edit / Reject buttons.
  - Once acted on, the card becomes read-only with a status badge ("Approved — feat/add-input-validation-a3f2", "Rejected").

#### Empty state

When the user navigates to the repository page with no active chat, the main content area shows the existing Kanban board (no change). The chat view only appears when the user clicks "New Chat" or selects an existing chat from the sidebar.

### API

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/chats` | Create a new chat. Body: `{ repository_path }`. Returns the `Chat`. |
| `GET` | `/api/chats` | List chats. Query params: `repository_path`. |
| `GET` | `/api/chats/[id]` | Get a single chat. |
| `DELETE` | `/api/chats/[id]` | Close and delete a chat (DB row + log file). |
| `POST` | `/api/chats/[id]/messages` | Send a user message. Body: `{ message }`. Starts or resumes the agent. |
| `GET` | `/api/chats/[id]/stream` | SSE stream of the chat log (same protocol as session streams). |
| `POST` | `/api/chats/[id]/proposals/[proposalId]/approve` | Approve a proposal. Body: `{ workflow_name?, inputs? }` (optional overrides). Creates worktree + workflow-run, resumes agent. Returns the created workflow-run. |
| `POST` | `/api/chats/[id]/proposals/[proposalId]/reject` | Reject a proposal. Body: `{ reason? }`. Resumes agent. |

### Database

```sql
CREATE TABLE IF NOT EXISTS chats (
  id                  TEXT PRIMARY KEY,
  repository_path     TEXT NOT NULL,
  title               TEXT,
  status              TEXT NOT NULL DEFAULT 'idle',
  agent_config        TEXT NOT NULL,
  log_file_path       TEXT NOT NULL,
  claude_session_id   TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_proposals (
  id                  TEXT PRIMARY KEY,       -- server-assigned UUID
  chat_id             TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  workflow_name       TEXT NOT NULL,
  inputs              TEXT NOT NULL,           -- JSON object
  rationale           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  workflow_run_id     TEXT REFERENCES workflow_runs(id), -- set on approval
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
```

`chat_proposals` are created server-side when the system receives the agent's structured output containing proposals. Each proposal gets a UUID. The `ON DELETE CASCADE` ensures proposals are cleaned up when the chat is closed.

### Implementation notes

- Domain: `src/backend/domain/chats/` — `ChatService`, `ChatAgent`,
  `ProposalService`, `chat-repository`, `system-prompt`, `chat-serializer`.
- API routes: `src/app/api/chats/route.ts` and
  `src/app/api/chats/[id]/{route.ts, messages, stream, history, proposals}`.
- UI: `src/app/(main)/repositories/[organization]/[name]/chat/[chatId]/`.
- A `GET /api/chats/[id]/history` endpoint is provided in addition to the
  endpoints listed above; it returns the serialized chat log for initial
  render before the SSE stream attaches.

## Out of scope

- Autonomous batch creation (approving all proposals in one action without per-proposal confirmation).
- Per-repository model override for the planning agent.
- Write access from chat agents (code modifications, commits).
- Chats not scoped to a repository.
- Chat title auto-generation (use first message truncation for now).

## Open questions

None at this time.
