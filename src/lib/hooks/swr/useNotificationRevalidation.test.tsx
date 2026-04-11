// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationEvent } from "@/shared/contracts/api";
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

  simulateMessage(data: NotificationEvent) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function TestComponent() {
  useNotificationRevalidation();
  return null;
}

function selectorFrom(
  mutate: ReturnType<typeof vi.fn>,
  callIndex = 0,
): (key: unknown) => boolean {
  const [selectorArg] = mutate.mock.calls[callIndex];
  expect(typeof selectorArg).toBe("function");
  return selectorArg;
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
  it("revalidates workflow-run and worktree caches for workflow-run.status-changed", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feat/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "running",
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    // mutate is called with the explicit {revalidate: true, populateCache: false}
    // options — the documented SWR pattern for refreshing matching keys without
    // clearing cached data (which would cause a loading flash).
    expect(mutate).toHaveBeenCalledWith(expect.any(Function), undefined, {
      revalidate: true,
      populateCache: false,
    });
    const [selectorArg] = mutate.mock.calls[0];

    // Matches workflow-run list keys
    expect(selectorArg(["/api/workflow-runs"])).toBe(true);
    expect(
      selectorArg([
        "/api/workflow-runs",
        { organization: "tmp", name: "repo", worktree_branch: "main" },
      ]),
    ).toBe(true);

    // Matches keys under the specific workflow run
    expect(selectorArg(["/api/workflow-runs", "wr1"])).toBe(true);
    expect(selectorArg(["/api/workflow-runs", "wr1", "steps"])).toBe(true);

    // Matches worktree list for the same repository
    expect(selectorArg(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      true,
    );

    // Does not match worktrees for a different repository
    expect(
      selectorArg(["/api/repositories", "other-org", "repo", "worktrees"]),
    ).toBe(false);

    // Does not match unrelated keys
    expect(selectorArg(["/api/sessions", "session-1"])).toBe(false);
    expect(selectorArg(["/api/workflow-runs", "wr-other"])).toBe(false);
  });

  it("ignores notifications without the type/payload structure", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    // Simulate a raw message without type/payload envelope
    MockEventSource.instances[0].onmessage?.({
      data: JSON.stringify({ foo: "bar" }),
    } as MessageEvent);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it("coalesces burst notifications into a single mutate call", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feat/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "running",
      },
    });
    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feat/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "awaiting",
      },
    });
    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr2",
        branchName: "feat/other",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "running",
      },
    });

    expect(mutate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    // Single mutate call with merged target paths
    expect(mutate).toHaveBeenCalledTimes(1);

    const selector = selectorFrom(mutate);
    expect(selector(["/api/workflow-runs"])).toBe(true);
    expect(selector(["/api/workflow-runs", "wr1"])).toBe(true);
    expect(selector(["/api/workflow-runs", "wr2"])).toBe(true);
    expect(selector(["/api/workflow-runs", "wr-other"])).toBe(false);
  });

  it("also revalidates /api/todos on step-execution.status-changed", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "step-execution.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feat/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        stepExecutionId: "step1",
        status: "running",
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const selector = selectorFrom(mutate);
    expect(selector(["/api/workflow-runs"])).toBe(true);
    expect(selector(["/api/workflow-runs", "wr1"])).toBe(true);
    expect(selector(["/api/todos"])).toBe(true);
    expect(selector(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      true,
    );
  });

  it("revalidates worktree caches on worktree.changed", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "worktree.changed",
      payload: { repositoryOrganization: "org", repositoryName: "repo" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const selector = selectorFrom(mutate);
    expect(selector(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      true,
    );
    expect(
      selector(["/api/repositories", "other-org", "repo", "worktrees"]),
    ).toBe(false);
    expect(selector(["/api/workflow-runs"])).toBe(false);
  });

  it("revalidates all repository caches when house-keeping sync completes", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "house-keeping.sync-status-changed",
      payload: { syncing: false },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const selector = selectorFrom(mutate);
    // Broad prefix matches all repository worktree keys
    expect(selector(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      true,
    );
    expect(
      selector(["/api/repositories", "other-org", "other-repo", "worktrees"]),
    ).toBe(true);
    // Does not match non-repository keys
    expect(selector(["/api/workflow-runs"])).toBe(false);
  });

  it("does not revalidate when syncing starts (syncing: true)", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "house-keeping.sync-status-changed",
      payload: { syncing: true },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    // mutate is called but with an empty matcher that matches nothing
    expect(mutate).toHaveBeenCalledTimes(1);
    const selector = selectorFrom(mutate);
    expect(selector(["/api/repositories", "org", "repo", "worktrees"])).toBe(
      false,
    );
  });

  it("revalidates chat list and chat detail caches for chat.status-changed", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "chat.status-changed",
      payload: {
        repositoryOrganization: "org",
        repositoryName: "repo",
        chatId: "chat-1",
        status: "running",
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const selector = selectorFrom(mutate);

    // Matches chat list keys (exact match for /api/chats/org/repo/)
    expect(selector(["/api/chats", "org", "repo"])).toBe(true);

    // Matches individual chat detail keys (prefix match for /api/chats/chat-1/)
    expect(selector(["/api/chats", "chat-1"])).toBe(true);
    expect(selector(["/api/chats", "chat-1", "messages"])).toBe(true);

    // Does not match chats for a different repository
    expect(selector(["/api/chats", "other-org", "other-repo"])).toBe(false);

    // Does not match a different chat
    expect(selector(["/api/chats", "chat-other"])).toBe(false);

    // Does not match unrelated keys
    expect(selector(["/api/workflow-runs"])).toBe(false);
  });

  it("clears buffer after flush so subsequent notifications are handled independently", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <SWRConfig value={{ mutate }}>
        <TestComponent />
      </SWRConfig>,
    );

    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feat/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "running",
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(1);

    // Second batch — different workflow run
    MockEventSource.instances[0].simulateMessage({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr2",
        branchName: "feat/other",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "running",
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mutate).toHaveBeenCalledTimes(2);
    const selector = selectorFrom(mutate, 1);
    expect(selector(["/api/workflow-runs", "wr2"])).toBe(true);
    // wr1 should not be in this batch
    expect(selector(["/api/workflow-runs", "wr1"])).toBe(false);
  });
});
