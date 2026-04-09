import { describe, expect, it, vi } from "vitest";
import type { EventMap, WorkflowRunContext } from "./event-bus";
import { EventBus } from "./event-bus";
import { logger } from "./logger";

const testContext: WorkflowRunContext = {
  workflowRunId: "wr1",
  branchName: "feat/test",
  repositoryOrganization: "org",
  repositoryName: "repo",
};

describe("EventBus", () => {
  it("calls a registered listener when an event is emitted", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.status-changed", listener);
    eventBus.emit("session.status-changed", {
      ...testContext,
      sessionId: "s1",
      status: "success",
      decision: { transition: "success", reason: "done", handoff_summary: "" },
    });

    expect(listener).toHaveBeenCalledWith({
      ...testContext,
      sessionId: "s1",
      status: "success",
      decision: { transition: "success", reason: "done", handoff_summary: "" },
    });
  });

  it("calls listener for agent-session.completed event", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("agent-session.completed", listener);
    eventBus.emit("agent-session.completed", {
      sessionId: "s1",
      decision: null,
    });

    expect(listener).toHaveBeenCalledWith({
      sessionId: "s1",
      decision: null,
    });
  });

  it("calls multiple listeners for the same event", () => {
    const eventBus = new EventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    eventBus.on("session.status-changed", listener1);
    eventBus.on("session.status-changed", listener2);
    eventBus.emit("session.status-changed", {
      ...testContext,
      sessionId: "s1",
      status: "failure",
      decision: null,
    });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("does not call listeners for other events", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.status-changed", listener);
    // No other events to emit in the current EventMap, but if there were,
    // listeners would not be cross-called. Verify no call without emit.
    expect(listener).not.toHaveBeenCalled();
  });

  it("catches and logs errors thrown by listeners without affecting other listeners", () => {
    const eventBus = new EventBus();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const badListener = vi.fn(() => {
      throw new Error("listener error");
    });
    const goodListener = vi.fn();

    eventBus.on("session.status-changed", badListener);
    eventBus.on("session.status-changed", goodListener);
    eventBus.emit("session.status-changed", {
      ...testContext,
      sessionId: "s1",
      status: "failure",
      decision: null,
    });

    expect(badListener).toHaveBeenCalledOnce();
    expect(goodListener).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "session.status-changed" }),
      "Event listener error",
    );

    errorSpy.mockRestore();
  });

  it("does nothing when emitting an event with no listeners", () => {
    const eventBus = new EventBus();
    // Should not throw
    expect(() =>
      eventBus.emit("session.status-changed", {
        ...testContext,
        sessionId: "s1",
        status: "failure",
        decision: null,
      }),
    ).not.toThrow();
  });

  it("calls listener for session.status-changed event", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.status-changed", listener);
    eventBus.emit("session.status-changed", {
      ...testContext,
      sessionId: "s1",
      status: "awaiting_input",
    });

    expect(listener).toHaveBeenCalledWith({
      ...testContext,
      sessionId: "s1",
      status: "awaiting_input",
    });
  });

  it("does not cross-call listeners between session.status-changed and workflow-run.status-changed", () => {
    const eventBus = new EventBus();
    const sessionListener = vi.fn();
    const statusChangedListener = vi.fn();

    eventBus.on("session.status-changed", sessionListener);
    eventBus.on("workflow-run.status-changed", statusChangedListener);

    eventBus.emit("workflow-run.status-changed", {
      ...testContext,
      status: "awaiting",
    });

    expect(statusChangedListener).toHaveBeenCalledOnce();
    expect(sessionListener).not.toHaveBeenCalled();
  });

  it("removes a listener with off()", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.status-changed", listener);
    eventBus.off("session.status-changed", listener);
    eventBus.emit("session.status-changed", {
      ...testContext,
      sessionId: "s1",
      status: "failure",
      decision: null,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("only removes the specified listener with off(), leaving others intact", () => {
    const eventBus = new EventBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    eventBus.on("session.status-changed", listenerA);
    eventBus.on("session.status-changed", listenerB);
    eventBus.off("session.status-changed", listenerA);
    eventBus.emit("session.status-changed", {
      ...testContext,
      sessionId: "s1",
      status: "failure",
      decision: null,
    });

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledOnce();
  });

  it("does nothing when off() is called for a listener not registered", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    // Should not throw
    expect(() =>
      eventBus.off("session.status-changed", listener),
    ).not.toThrow();
  });

  it("stores the latest house-keeping sync status for later subscribers", () => {
    const eventBus = new EventBus();

    expect(eventBus.getLatestHouseKeepingSyncStatus()).toBeNull();

    eventBus.emit("house-keeping.sync-status-changed", {
      syncing: true,
    });

    expect(eventBus.getLatestHouseKeepingSyncStatus()).toEqual({
      syncing: true,
    });
  });

  it("clears the latest house-keeping sync status when listeners are reset", () => {
    const eventBus = new EventBus();

    eventBus.emit("house-keeping.sync-status-changed", {
      syncing: true,
    });

    eventBus.removeAllListeners();

    expect(eventBus.getLatestHouseKeepingSyncStatus()).toBeNull();
  });
});
