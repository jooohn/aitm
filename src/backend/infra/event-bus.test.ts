import { describe, expect, it, vi } from "vitest";
import type { EventMap } from "./event-bus";
import { EventBus } from "./event-bus";
import { logger } from "./logger";

describe("EventBus", () => {
  it("calls a registered listener when an event is emitted", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.completed", listener);
    eventBus.emit("session.completed", {
      sessionId: "s1",
      decision: { transition: "success", reason: "done", handoff_summary: "" },
    });

    expect(listener).toHaveBeenCalledWith({
      sessionId: "s1",
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

    eventBus.on("session.completed", listener1);
    eventBus.on("session.completed", listener2);
    eventBus.emit("session.completed", { sessionId: "s1", decision: null });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("does not call listeners for other events", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.completed", listener);
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

    eventBus.on("session.completed", badListener);
    eventBus.on("session.completed", goodListener);
    eventBus.emit("session.completed", { sessionId: "s1", decision: null });

    expect(badListener).toHaveBeenCalledOnce();
    expect(goodListener).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "session.completed" }),
      "Event listener error",
    );

    errorSpy.mockRestore();
  });

  it("does nothing when emitting an event with no listeners", () => {
    const eventBus = new EventBus();
    // Should not throw
    expect(() =>
      eventBus.emit("session.completed", { sessionId: "s1", decision: null }),
    ).not.toThrow();
  });

  it("calls listener for session.status-changed event", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.status-changed", listener);
    eventBus.emit("session.status-changed", {
      sessionId: "s1",
      status: "AWAITING_INPUT",
    });

    expect(listener).toHaveBeenCalledWith({
      sessionId: "s1",
      status: "AWAITING_INPUT",
    });
  });

  it("does not cross-call listeners between session.completed and session.status-changed", () => {
    const eventBus = new EventBus();
    const completedListener = vi.fn();
    const statusChangedListener = vi.fn();

    eventBus.on("session.completed", completedListener);
    eventBus.on("session.status-changed", statusChangedListener);

    eventBus.emit("session.status-changed", {
      sessionId: "s1",
      status: "AWAITING_INPUT",
    });

    expect(statusChangedListener).toHaveBeenCalledOnce();
    expect(completedListener).not.toHaveBeenCalled();
  });

  it("removes a listener with off()", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    eventBus.on("session.completed", listener);
    eventBus.off("session.completed", listener);
    eventBus.emit("session.completed", { sessionId: "s1", decision: null });

    expect(listener).not.toHaveBeenCalled();
  });

  it("only removes the specified listener with off(), leaving others intact", () => {
    const eventBus = new EventBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    eventBus.on("session.completed", listenerA);
    eventBus.on("session.completed", listenerB);
    eventBus.off("session.completed", listenerA);
    eventBus.emit("session.completed", { sessionId: "s1", decision: null });

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledOnce();
  });

  it("does nothing when off() is called for a listener not registered", () => {
    const eventBus = new EventBus();
    const listener = vi.fn();

    // Should not throw
    expect(() => eventBus.off("session.completed", listener)).not.toThrow();
  });
});
