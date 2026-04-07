import { afterEach, describe, expect, it, vi } from "vitest";

describe("container bootstrap", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("uses the default config when loaded by Vitest without a config file", async () => {
    delete process.env.AITM_CONFIG_PATH;

    const container = await import("./container");

    expect(container.config).toEqual({
      agent: { provider: "claude" },
      repositories: [],
      workflows: {},
    });
  });
});
