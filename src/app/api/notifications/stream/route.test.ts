import { describe, expect, it, vi } from "vitest";
import { eventBus } from "@/backend/infra/event-bus";
import { GET } from "./route";

describe("GET /api/notifications/stream", () => {
  it("returns a text/event-stream response", async () => {
    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
  });

  it("streams workflow-run.status-changed events as SSE messages", async () => {
    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    // Emit event after the stream is opened
    eventBus.emit("workflow-run.status-changed", {
      workflowRunId: "wr1",
      branchName: "feature/test",
      repositoryOrganization: "org",
      repositoryName: "repo",
      status: "awaiting",
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain("data:");
    expect(text).toContain('"workflowRunId":"wr1"');
    expect(text).toContain('"status":"awaiting"');

    // Cancel to clean up
    await reader.cancel();
  });

  it("streams house-keeping sync notifications as SSE messages", async () => {
    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    eventBus.emit("house-keeping.sync-status-changed", {
      syncing: true,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain("data:");
    expect(text).toContain('"syncing":true');

    await reader.cancel();
  });

  it("replays the latest house-keeping sync status when the stream opens", async () => {
    eventBus.emit("house-keeping.sync-status-changed", {
      syncing: true,
    });

    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain("data:");
    expect(text).toContain('"syncing":true');

    await reader.cancel();
  });

  it("removes the listener from EventBus when the stream is cancelled", async () => {
    const offSpy = vi.spyOn(eventBus, "off");

    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    const reader = res.body!.getReader();
    await reader.cancel();

    expect(offSpy).toHaveBeenCalledWith(
      "house-keeping.sync-status-changed",
      expect.any(Function),
    );
    expect(offSpy).toHaveBeenCalledWith(
      "workflow-run.status-changed",
      expect.any(Function),
    );

    offSpy.mockRestore();
  });
});
