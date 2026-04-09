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

    expect(mutate).toHaveBeenCalledTimes(3);
    expect(mutate).toHaveBeenNthCalledWith(1, ["/api/workflow-runs", "wr1"]);

    // Second call: workflow-run list selector
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

    // Third call: worktree list selector
    const [wtSelectorArg, wtDataArg, wtOptionsArg] = mutate.mock.calls[2];
    expect(typeof wtSelectorArg).toBe("function");
    expect(wtDataArg).toBeUndefined();
    expect(wtOptionsArg).toEqual({ revalidate: true });
    expect(
      wtSelectorArg(["/api/repositories", "org", "repo", "worktrees"]),
    ).toBe(true);
    expect(wtSelectorArg(["/api/workflow-runs"])).toBe(false);
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

    expect(mutate).toHaveBeenCalledTimes(4);
    expect(mutate).toHaveBeenNthCalledWith(1, ["/api/workflow-runs", "wr1"]);
    expect(mutate).toHaveBeenNthCalledWith(2, ["/api/workflow-runs", "wr2"]);

    const [selectorArg, dataArg, optionsArg] = mutate.mock.calls[2];
    expect(typeof selectorArg).toBe("function");
    expect(dataArg).toBeUndefined();
    expect(optionsArg).toEqual({ revalidate: true });

    // Fourth call: worktree list selector
    const [wtSelectorArg] = mutate.mock.calls[3];
    expect(typeof wtSelectorArg).toBe("function");
  });

  it("revalidates worktree caches alongside workflow-run caches on workflow-run events", async () => {
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

    // Should have 3 calls: individual workflow-run key, workflow-run list selector, worktree selector
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(mutate).toHaveBeenNthCalledWith(1, ["/api/workflow-runs", "wr1"]);

    // Third call should be the worktree list selector
    const [worktreeSelectorArg, worktreeDataArg, worktreeOptionsArg] =
      mutate.mock.calls[2];
    expect(typeof worktreeSelectorArg).toBe("function");
    expect(worktreeDataArg).toBeUndefined();
    expect(worktreeOptionsArg).toEqual({ revalidate: true });

    // Worktree selector should match worktree list keys
    expect(
      worktreeSelectorArg([
        "/api/repositories",
        "my-org",
        "my-repo",
        "worktrees",
      ]),
    ).toBe(true);
    // Should not match other keys
    expect(worktreeSelectorArg(["/api/repositories"])).toBe(false);
    expect(
      worktreeSelectorArg(["/api/repositories", "my-org", "my-repo"]),
    ).toBe(false);
    expect(worktreeSelectorArg(["/api/workflow-runs"])).toBe(false);
  });

  it("revalidates worktree caches when house-keeping sync completes (syncing: false)", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({ syncing: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    // Should revalidate worktree caches
    expect(mutate).toHaveBeenCalledTimes(1);

    const [selectorArg, dataArg, optionsArg] = mutate.mock.calls[0];
    expect(typeof selectorArg).toBe("function");
    expect(dataArg).toBeUndefined();
    expect(optionsArg).toEqual({ revalidate: true });

    // Should match worktree list keys
    expect(selectorArg(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      true,
    );
    // Should not match other keys
    expect(selectorArg(["/api/workflow-runs"])).toBe(false);
  });

  it("revalidates worktree caches when worktreeChanged notification is received", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({ worktreeChanged: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);

    const [selectorArg, dataArg, optionsArg] = mutate.mock.calls[0];
    expect(typeof selectorArg).toBe("function");
    expect(dataArg).toBeUndefined();
    expect(optionsArg).toEqual({ revalidate: true });

    expect(selectorArg(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      true,
    );
    expect(selectorArg(["/api/workflow-runs"])).toBe(false);
  });

  it("does not revalidate worktree caches when syncing starts (syncing: true)", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({ syncing: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).not.toHaveBeenCalled();
  });
});
