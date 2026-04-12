import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeContainer } from "@/backend/container";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { DELETE, GET, POST } from "./route";

let configFile: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  await writeTestConfig(
    configFile,
    `
repositories: []
workflows: {}
`,
  );
  initializeContainer();
});

describe("POST /api/mcp", () => {
  it("serves MCP initialize over the stateless HTTP transport", async () => {
    const request = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "mcp-protocol-version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "vitest",
            version: "1.0.0",
          },
        },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "aitm",
          version: "0.1.0",
        },
      },
    });
  });
});

describe("/api/mcp non-POST methods", () => {
  it("rejects GET for the stateless first pass", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/mcp", { method: "GET" }),
    );

    expect(response.status).toBe(405);
  });

  it("rejects DELETE for the stateless first pass", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/mcp", { method: "DELETE" }),
    );

    expect(response.status).toBe(405);
  });
});
