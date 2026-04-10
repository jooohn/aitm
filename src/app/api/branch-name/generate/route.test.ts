import { describe, expect, it } from "vitest";
import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/branch-name/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/branch-name/generate", () => {
  it("returns 200 with generated branch name", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "development-flow",
        inputs: { "feature-description": "Add dark mode support" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toMatch(/^feat\/add-dark-mode-support-[a-z0-9]+$/);
  });

  it("returns 422 when workflow_name is missing", async () => {
    const res = await POST(
      makeRequest({
        inputs: { description: "something" },
      }),
    );
    expect(res.status).toBe(422);
  });

  it("generates a fallback name when inputs are empty", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "bugfix-flow",
        inputs: {},
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toMatch(/^fix\/\d+-[a-z0-9]+$/);
  });

  it("works without inputs field", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "development-flow",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toMatch(/^feat\/\d+-[a-z0-9]+$/);
  });

  it("treats null inputs as empty inputs", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "development-flow",
        inputs: null,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toMatch(/^feat\/\d+-[a-z0-9]+$/);
  });

  it("returns 422 when inputs is not an object", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "development-flow",
        inputs: 123,
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/inputs/i);
  });

  it("returns 422 when inputs contains non-string values", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "development-flow",
        inputs: { description: 42 },
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/inputs/i);
  });

  it("returns 422 when inputs is an array", async () => {
    const res = await POST(
      makeRequest({
        workflow_name: "development-flow",
        inputs: ["hello"],
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/inputs/i);
  });

  it("returns 422 for malformed JSON body", async () => {
    const req = new Request("http://localhost/api/branch-name/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
  });
});
