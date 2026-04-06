# ADR: Event Bus for Inter-Service Communication

**Status:** accepted
**Date:** 2026-04-05

## Context

aitm's backend has several domain services that need to react to each other's state changes:

- When a session completes, `WorkflowRunService` needs to advance the workflow.
- When a workflow run's status changes, the UI needs to be notified.
- When a step execution enters `awaiting-approval`, the UI needs to show the approval prompt.

Direct service-to-service calls create tight coupling. For example, `SessionService` would need to import and call `WorkflowRunService` directly, creating a circular dependency between the session and workflow-run domains. The session layer should not know about workflow advancement logic.

## Decision

Use a typed in-process `EventBus` (`src/backend/infra/event-bus.ts`) for inter-service communication. The EventBus provides a strongly-typed publish/subscribe mechanism with the following events:

- `session.completed` — emitted when a session reaches a real workflow transition (not `__REQUIRE_USER_INPUT__`)
- `session.status-changed` — emitted on any session status change
- `step-execution.awaiting-approval` — emitted when a manual approval step is reached
- `workflow-run.status-changed` — emitted when a workflow run's status changes

Services subscribe to events in their constructors. For example, `WorkflowRunService` subscribes to `session.completed` to advance the workflow when a session finishes.

## Consequences

- **Decoupled domains**: Session management does not import workflow-run logic and vice versa. Communication flows through events.
- **Type safety**: `EventMap` interface ensures event names and payloads are statically checked — no stringly-typed event names or untyped payloads.
- **In-process only**: The EventBus is an in-memory pub/sub within a single Node.js process. Not distributed, no persistence, no replay. This is sufficient for aitm's single-server architecture.
- **Ordering**: Events are delivered synchronously in emit order. Listeners run sequentially within a single `emit()` call.
- **Testability**: Services can be tested by emitting events directly rather than wiring up full dependency chains.
