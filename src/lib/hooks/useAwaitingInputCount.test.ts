// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAwaitingInputCount } from "./useAwaitingInputCount";

const { fetchAllWorkflowRunsMock } = vi.hoisted(() => ({
  fetchAllWorkflowRunsMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchAllWorkflowRuns: fetchAllWorkflowRunsMock,
}));

let capturedCallback: (() => void) | null = null;

vi.mock("./useNotificationStream", () => ({
  useNotificationStream: (cb: () => void) => {
    capturedCallback = cb;
  },
}));

beforeEach(() => {
  fetchAllWorkflowRunsMock.mockReset();
  fetchAllWorkflowRunsMock.mockResolvedValue([]);
  capturedCallback = null;
});

describe("useAwaitingInputCount", () => {
  it("fetches workflow runs with 'awaiting' status on mount", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([
      { id: "wr1", status: "awaiting" },
      { id: "wr2", status: "awaiting" },
    ]);

    const { result } = renderHook(() => useAwaitingInputCount());

    await waitFor(() => {
      expect(result.current.count).toBe(2);
    });

    expect(fetchAllWorkflowRunsMock).toHaveBeenCalledWith("awaiting");
  });

  it("uses useNotificationStream for SSE events", async () => {
    renderHook(() => useAwaitingInputCount());

    await waitFor(() => {
      expect(capturedCallback).not.toBeNull();
    });
  });

  it("re-fetches count when notification stream fires", async () => {
    fetchAllWorkflowRunsMock
      .mockResolvedValueOnce([{ id: "wr1", status: "awaiting" }])
      .mockResolvedValueOnce([
        { id: "wr1", status: "awaiting" },
        { id: "wr2", status: "awaiting" },
      ]);

    const { result } = renderHook(() => useAwaitingInputCount());

    await waitFor(() => {
      expect(result.current.count).toBe(1);
    });

    // Simulate SSE message via captured callback
    act(() => {
      capturedCallback!();
    });

    await waitFor(() => {
      expect(result.current.count).toBe(2);
    });
  });

  it("handles initial fetch error without crashing", async () => {
    fetchAllWorkflowRunsMock.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAwaitingInputCount());

    // Should stay at 0 and not throw
    await waitFor(() => {
      expect(fetchAllWorkflowRunsMock).toHaveBeenCalled();
    });

    expect(result.current.count).toBe(0);
  });
});
