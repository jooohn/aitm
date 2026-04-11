# Lazy Chat Persistence

**Date:** 2026-04-11
**Status:** accepted

## Context

The planning assistant's "New Chat" button originally created a database record immediately on click, then navigated to the chat view. If the user never sent a message, an empty chat was left behind, cluttering the chat list. This was a poor UX — users who clicked "New Chat" accidentally or changed their mind would accumulate orphaned records.

## Decision

Defer chat persistence until the first message is sent. The "New Chat" button now navigates to a `/chat/new` route that renders the chat UI in a "draft" state with no database record. On first message send, the frontend creates the chat via `POST /api/chats`, sends the message via `POST /api/chats/[id]/messages`, and then replaces the URL to `/chat/[chatId]` to prevent back-navigation to the draft page.

No backend changes were required — the existing `createChat` and `sendChatMessage` API endpoints are called in sequence from the frontend.

## Consequences

- Empty chats are no longer created when the user clicks "New Chat" without sending a message.
- The draft chat does not appear in the sidebar until persisted, which happens naturally since there is no DB record.
- If `createChat` succeeds but `sendChatMessage` fails, an empty chat record is created — the same state as before, acceptable for now.
- The `/chat/new` route uses `router.replace` after creation to avoid the user navigating back to the draft page via the browser back button.

## Alternatives considered

- **Backend-side lazy creation**: Have the backend create the chat only when the first message arrives (single API call). This would simplify the frontend but requires a new endpoint or overloading `sendChatMessage` to accept a repository path instead of a chat ID. Deferred in favor of the simpler frontend-only approach.
- **Cleanup job for empty chats**: Keep eager creation but periodically delete chats with no messages. Adds operational complexity and doesn't solve the UX issue of empty chats appearing in the sidebar between creation and cleanup.
