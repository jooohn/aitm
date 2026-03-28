import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigRepositories } from "./config";

let configFile: string;

beforeEach(() => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
});

afterEach(() => {
  rmSync(configFile, { force: true });
  delete process.env.AITM_CONFIG_PATH;
});

describe("getConfigRepositories", () => {
  it("returns empty array when config file does not exist", () => {
    expect(getConfigRepositories()).toEqual([]);
  });

  it("returns empty array when repositories key is absent", () => {
    writeFileSync(configFile, "workflows: {}");
    expect(getConfigRepositories()).toEqual([]);
  });

  it("returns repositories from config", () => {
    writeFileSync(
      configFile,
      `
repositories:
  - path: /projects/org/repo1
  - path: /projects/org/repo2
`,
    );
    expect(getConfigRepositories()).toEqual([
      { path: "/projects/org/repo1" },
      { path: "/projects/org/repo2" },
    ]);
  });
});
