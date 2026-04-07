// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRTestProvider } from "@/test-swr-provider";
import { useAwaitingInputCount } from "./useAwaitingInputCount";

const { fetchAllWorkflowRunsMock } = vi.hoisted(() => ({
  fetchAllWorkflowRunsMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchAllWorkflowRuns: fetchAllWorkflowRunsMock,
}));

beforeEach(() => {
  fetchAllWorkflowRunsMock.mockReset();
  fetchAllWorkflowRunsMock.mockResolvedValue([]);
});

describe("useAwaitingInputCount", () => {
  it("fetches workflow runs with 'awaiting' status on mount", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([
      { id: "wr1", status: "awaiting" },
      { id: "wr2", status: "awaiting" },
    ]);

    const { result } = renderHook(() => useAwaitingInputCount(), {
      wrapper: SWRTestProvider,
    });

    await waitFor(() => {
      expect(result.current.count).toBe(2);
    });

    expect(fetchAllWorkflowRunsMock).toHaveBeenCalledWith("awaiting");
  });

  it("returns count from the SWR hook", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([
      { id: "wr1", status: "awaiting" },
    ]);

    const { result } = renderHook(() => useAwaitingInputCount(), {
      wrapper: SWRTestProvider,
    });

    await waitFor(() => {
      expect(result.current.count).toBe(1);
    });
  });

  it("handles initial fetch error without crashing", async () => {
    fetchAllWorkflowRunsMock.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAwaitingInputCount(), {
      wrapper: SWRTestProvider,
    });

    // Should stay at 0 and not throw
    await waitFor(() => {
      expect(fetchAllWorkflowRunsMock).toHaveBeenCalled();
    });

    expect(result.current.count).toBe(0);
  });
});
