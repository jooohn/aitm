import { writeFile } from "fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeConfig } from "@/backend/infra/config";
import { setupTestConfigDir } from "@/test-config-helper";
import { GET } from "./route";

let configFile: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();
});

describe("GET /api/workflows", () => {
  it("returns 200 with empty object when no workflows configured", async () => {
    await writeFile(configFile, "repositories: []\n");
    await initializeConfig();
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
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    await initializeConfig();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("my-flow");
    expect(body["my-flow"].initial_step).toBe("plan");
  });
});
