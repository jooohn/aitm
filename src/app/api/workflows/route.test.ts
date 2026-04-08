import { writeFile } from "fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeContainer } from "@/backend/container";
import { setupTestConfigDir } from "@/test-config-helper";
import { GET } from "./route";

let configFile: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();
});

describe("GET /api/workflows", () => {
  it("returns 200 with empty object when no workflows configured", async () => {
    await writeFile(configFile, "repositories: []\n");
    initializeContainer();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("returns configured workflows as a map of name to definition", async () => {
    await writeFile(
      configFile,
      `
workflows:
  my-flow:
    label: My Flow
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    initializeContainer();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("my-flow");
    expect(body["my-flow"].label).toBe("My Flow");
    expect(body["my-flow"].initial_step).toBe("plan");
  });
});
