// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTesting,
  useNotificationStream,
} from "./useNotificationStream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

beforeEach(() => {
  _resetForTesting();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNotificationStream", () => {
  it("opens a single EventSource for multiple subscribers", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { unmount: unmount1 } = renderHook(() =>
      useNotificationStream(callback1),
    );
    const { unmount: unmount2 } = renderHook(() =>
      useNotificationStream(callback2),
    );

    // Only one EventSource should be created
    expect(MockEventSource.instances).toHaveLength(1);

    unmount1();
    unmount2();
  });

  it("dispatches messages to all active subscribers", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    renderHook(() => useNotificationStream(callback1));
    renderHook(() => useNotificationStream(callback2));

    act(() => {
      MockEventSource.instances[0].simulateMessage(
        JSON.stringify({ sessionId: "s1", status: "AWAITING_INPUT" }),
      );
    });

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).toHaveBeenCalledOnce();
  });

  it("closes EventSource when last subscriber unmounts", () => {
    const { unmount: unmount1 } = renderHook(() =>
      useNotificationStream(vi.fn()),
    );
    const { unmount: unmount2 } = renderHook(() =>
      useNotificationStream(vi.fn()),
    );

    unmount1();
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled();

    unmount2();
    expect(MockEventSource.instances[0].close).toHaveBeenCalled();
  });

  it("does not dispatch to unsubscribed callbacks", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { unmount: unmount1 } = renderHook(() =>
      useNotificationStream(callback1),
    );
    renderHook(() => useNotificationStream(callback2));

    unmount1();

    act(() => {
      MockEventSource.instances[0].simulateMessage(
        JSON.stringify({ sessionId: "s1", status: "AWAITING_INPUT" }),
      );
    });

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledOnce();
  });
});
