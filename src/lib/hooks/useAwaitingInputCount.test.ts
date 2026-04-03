// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAwaitingInputCount } from "./useAwaitingInputCount";

const { fetchSessionsByStatusMock } = vi.hoisted(() => ({
  fetchSessionsByStatusMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchSessionsByStatus: fetchSessionsByStatusMock,
}));

let capturedCallback: (() => void) | null = null;

vi.mock("./useNotificationStream", () => ({
  useNotificationStream: (cb: () => void) => {
    capturedCallback = cb;
  },
}));

beforeEach(() => {
  fetchSessionsByStatusMock.mockReset();
  capturedCallback = null;
});

describe("useAwaitingInputCount", () => {
  it("fetches initial count on mount", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);

    const { result } = renderHook(() => useAwaitingInputCount());

    await waitFor(() => {
      expect(result.current.count).toBe(2);
    });

    expect(fetchSessionsByStatusMock).toHaveBeenCalledWith("AWAITING_INPUT");
  });

  it("uses useNotificationStream for SSE events", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([]);

    renderHook(() => useAwaitingInputCount());

    await waitFor(() => {
      expect(capturedCallback).not.toBeNull();
    });
  });

  it("re-fetches count when notification stream fires", async () => {
    fetchSessionsByStatusMock
      .mockResolvedValueOnce([{ id: "s1" }])
      .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }]);

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
    fetchSessionsByStatusMock.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAwaitingInputCount());

    // Should stay at 0 and not throw
    await waitFor(() => {
      expect(fetchSessionsByStatusMock).toHaveBeenCalled();
    });

    expect(result.current.count).toBe(0);
  });
});
