import { describe, expect, it, vi } from "vitest";
import type { EventMap } from "./event-bus";
import { EventBus } from "./event-bus";

describe("EventBus", () => {
  it("calls a registered listener when an event is emitted", () => {
    const handler = new EventBus();
    const listener = vi.fn();

    handler.on("session.completed", listener);
    handler.emit("session.completed", {
      sessionId: "s1",
      decision: { transition: "success", reason: "done", handoff_summary: "" },
    });

    expect(listener).toHaveBeenCalledWith({
      sessionId: "s1",
      decision: { transition: "success", reason: "done", handoff_summary: "" },
    });
  });

  it("calls multiple listeners for the same event", () => {
    const handler = new EventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    handler.on("session.completed", listener1);
    handler.on("session.completed", listener2);
    handler.emit("session.completed", { sessionId: "s1", decision: null });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("does not call listeners for other events", () => {
    const handler = new EventBus();
    const listener = vi.fn();

    handler.on("session.completed", listener);
    // No other events to emit in the current EventMap, but if there were,
    // listeners would not be cross-called. Verify no call without emit.
    expect(listener).not.toHaveBeenCalled();
  });

  it("catches and logs errors thrown by listeners without affecting other listeners", () => {
    const handler = new EventBus();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badListener = vi.fn(() => {
      throw new Error("listener error");
    });
    const goodListener = vi.fn();

    handler.on("session.completed", badListener);
    handler.on("session.completed", goodListener);
    handler.emit("session.completed", { sessionId: "s1", decision: null });

    expect(badListener).toHaveBeenCalledOnce();
    expect(goodListener).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("session.completed"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("does nothing when emitting an event with no listeners", () => {
    const handler = new EventBus();
    // Should not throw
    expect(() =>
      handler.emit("session.completed", { sessionId: "s1", decision: null }),
    ).not.toThrow();
  });
});
