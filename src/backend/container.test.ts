import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";

describe("container bootstrap", () => {
  let configFile: string;

  beforeEach(async () => {
    configFile = await setupTestConfigDir();
    await writeTestConfig(configFile, "");
  });

  afterEach(() => {
    delete process.env.NEXT_PHASE;
    vi.resetModules();
  });

  it("uses the default config when loaded by Vitest without a config file", async () => {
    delete process.env.AITM_CONFIG_PATH;

    const { getContainer } = await import("./container");

    expect(getContainer().config).toEqual({
      agents: { default: { provider: "claude" } },
      default_agent: "default",
      repositories: [],
      workflows: {},
    });
  });

  it("uses the default config during Next production builds", async () => {
    delete process.env.AITM_CONFIG_PATH;
    process.env.NEXT_PHASE = "phase-production-build";

    const { getContainer } = await import("./container");

    expect(getContainer().config).toEqual({
      agents: { default: { provider: "claude" } },
      default_agent: "default",
      repositories: [],
      workflows: {},
    });
  });

  it("getContainer() returns the same object on repeated calls", async () => {
    const { getContainer } = await import("./container");

    const first = getContainer();
    const second = getContainer();

    expect(first).toBe(second);
  });

  it("getContainer() returns a Container with all expected services", async () => {
    const { getContainer } = await import("./container");

    const container = getContainer();

    expect(container.config).toBeDefined();
    expect(container.sessionService).toBeDefined();
    expect(container.repositoryService).toBeDefined();
    expect(container.worktreeService).toBeDefined();
    expect(container.agentService).toBeDefined();
    expect(container.chatService).toBeDefined();
    expect(container.workflowRunService).toBeDefined();
    expect(container.houseKeepingService).toBeDefined();
    expect(container.commandStepExecutor).toBeDefined();
    expect(container.workflowRunRepository).toBeDefined();
    expect(container.sessionRepository).toBeDefined();
    expect(container.chatRepository).toBeDefined();
  });

  it("initializeContainer() rebuilds the container with fresh config", async () => {
    const { getContainer, initializeContainer } = await import("./container");

    const first = getContainer();
    initializeContainer();
    const second = getContainer();

    // After re-initialization, getContainer returns a new object
    expect(first).not.toBe(second);
  });

  it("processService survives initializeContainer() calls", async () => {
    const mod = await import("./container");

    const processBefore = mod.processService;
    mod.initializeContainer();
    const processAfter = mod.processService;

    expect(processBefore).toBe(processAfter);
  });

  it("getContainer() auto-initializes on first call (lazy init)", async () => {
    // The container module no longer calls buildContainer at import time.
    // Instead, getContainer() lazily initializes. This test verifies
    // that getContainer() works without an explicit initializeContainer() call.
    const { getContainer } = await import("./container");

    // Should not throw
    const container = getContainer();
    expect(container.config).toBeDefined();
    expect(container.sessionService).toBeDefined();
  });
});
