import { afterEach, describe, expect, it, vi } from "vitest";

const initializeContainer = vi.fn();
const recoverCrashedSessions = vi.fn();
const recoverCrashedWorkflowRuns = vi.fn();
const recoverCrashedChats = vi.fn();
const startPeriodicHouseKeeping = vi.fn();

vi.mock("./backend/container", () => ({
  initializeContainer,
  getContainer: () => ({
    sessionService: { recoverCrashedSessions },
    workflowRunService: { recoverCrashedWorkflowRuns },
    chatService: { recoverCrashedChats },
    houseKeepingService: { startPeriodicHouseKeeping },
  }),
}));

afterEach(() => {
  delete process.env.NEXT_RUNTIME;
  vi.clearAllMocks();
});

describe("register", () => {
  it("initializes container before starting recovery jobs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("./instrumentation");

    await register();

    expect(initializeContainer).toHaveBeenCalledOnce();
    expect(recoverCrashedSessions).toHaveBeenCalledOnce();
    expect(recoverCrashedWorkflowRuns).toHaveBeenCalledOnce();
    expect(recoverCrashedChats).toHaveBeenCalledOnce();
    expect(startPeriodicHouseKeeping).toHaveBeenCalledOnce();
    expect(initializeContainer.mock.invocationCallOrder[0]).toBeLessThan(
      recoverCrashedSessions.mock.invocationCallOrder[0],
    );
  });

  it("propagates container initialization failures", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    initializeContainer.mockImplementationOnce(() => {
      throw new Error("bad config");
    });
    const { register } = await import("./instrumentation");

    await expect(register()).rejects.toThrow("bad config");
    expect(recoverCrashedSessions).not.toHaveBeenCalled();
    expect(recoverCrashedWorkflowRuns).not.toHaveBeenCalled();
    expect(recoverCrashedChats).not.toHaveBeenCalled();
    expect(startPeriodicHouseKeeping).not.toHaveBeenCalled();
  });
});
