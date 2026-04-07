import { afterEach, describe, expect, it, vi } from "vitest";

const initializeConfig = vi.fn();
const recoverCrashedSessions = vi.fn();
const recoverCrashedWorkflowRuns = vi.fn();
const startPeriodicHouseKeeping = vi.fn();

vi.mock("./backend/infra/config", () => ({
  initializeConfig,
}));

vi.mock("./backend/container", () => ({
  sessionService: { recoverCrashedSessions },
  workflowRunService: { recoverCrashedWorkflowRuns },
  houseKeepingService: { startPeriodicHouseKeeping },
}));

afterEach(() => {
  delete process.env.NEXT_RUNTIME;
  vi.clearAllMocks();
});

describe("register", () => {
  it("initializes config before starting recovery jobs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("./instrumentation");

    await register();

    expect(initializeConfig).toHaveBeenCalledOnce();
    expect(recoverCrashedSessions).toHaveBeenCalledOnce();
    expect(recoverCrashedWorkflowRuns).toHaveBeenCalledOnce();
    expect(startPeriodicHouseKeeping).toHaveBeenCalledOnce();
    expect(initializeConfig.mock.invocationCallOrder[0]).toBeLessThan(
      recoverCrashedSessions.mock.invocationCallOrder[0],
    );
  });

  it("propagates config initialization failures", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    initializeConfig.mockRejectedValueOnce(new Error("bad config"));
    const { register } = await import("./instrumentation");

    await expect(register()).rejects.toThrow("bad config");
    expect(recoverCrashedSessions).not.toHaveBeenCalled();
    expect(recoverCrashedWorkflowRuns).not.toHaveBeenCalled();
    expect(startPeriodicHouseKeeping).not.toHaveBeenCalled();
  });
});
