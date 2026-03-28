import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

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
  delete process.env.AITM_CONFIG_PATH;
});

describe("GET /api/workflows", () => {
  it("returns 200 with empty object when no workflows configured", async () => {
    writeFileSync(configFile, "repositories: []\n");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("returns configured workflows as a map of name to definition", async () => {
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("my-flow");
    expect(body["my-flow"].initial_state).toBe("plan");
  });
});
