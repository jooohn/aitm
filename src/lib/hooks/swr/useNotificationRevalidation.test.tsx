// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTesting } from "../useNotificationStream";
import { useNotificationRevalidation } from "./useNotificationRevalidation";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(_url: string) {
    MockEventSource.instances.push(this);
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function TestComponent() {
  useNotificationRevalidation();
  return null;
}

beforeEach(() => {
  _resetForTesting();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  _resetForTesting();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useNotificationRevalidation", () => {
  it("revalidates workflow-run caches for workflow notifications only", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      workflowRunId: "wr1",
      status: "running",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenNthCalledWith(1, ["/api/workflow-runs", "wr1"]);

    const [selectorArg, dataArg, optionsArg] = mutate.mock.calls[1];
    expect(typeof selectorArg).toBe("function");
    expect(dataArg).toBeUndefined();
    expect(optionsArg).toEqual({ revalidate: true });

    expect(selectorArg(["/api/workflow-runs", "wr1"])).toBe(false);
    expect(selectorArg(["/api/workflow-runs"])).toBe(true);
    expect(
      selectorArg([
        "/api/workflow-runs",
        { organization: "tmp", name: "repo", worktree_branch: "main" },
      ]),
    ).toBe(true);
    expect(selectorArg(["/api/sessions", "session-1"])).toBe(false);
  });

  it("ignores notifications without a workflow run id", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({ foo: "bar" });

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it("coalesces burst notifications before revalidating workflow-run caches", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      workflowRunId: "wr1",
      status: "running",
    });
    MockEventSource.instances[0].simulateMessage({
      workflowRunId: "wr1",
      status: "awaiting",
    });
    MockEventSource.instances[0].simulateMessage({
      workflowRunId: "wr2",
      status: "running",
    });

    expect(mutate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(3);
    expect(mutate).toHaveBeenNthCalledWith(1, ["/api/workflow-runs", "wr1"]);
    expect(mutate).toHaveBeenNthCalledWith(2, ["/api/workflow-runs", "wr2"]);

    const [selectorArg, dataArg, optionsArg] = mutate.mock.calls[2];
    expect(typeof selectorArg).toBe("function");
    expect(dataArg).toBeUndefined();
    expect(optionsArg).toEqual({ revalidate: true });
  });
});
