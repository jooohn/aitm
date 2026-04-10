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

  it("streams workflow-run.status-changed events as SSE messages with type and payload", async () => {
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
    const json = JSON.parse(text.replace("data: ", "").trim());
    expect(json).toEqual({
      type: "workflow-run.status-changed",
      payload: {
        workflowRunId: "wr1",
        branchName: "feature/test",
        repositoryOrganization: "org",
        repositoryName: "repo",
        status: "awaiting",
      },
    });

    // Cancel to clean up
    await reader.cancel();
  });

  it("streams house-keeping sync notifications as SSE messages with type and payload", async () => {
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
    const json = JSON.parse(text.replace("data: ", "").trim());
    expect(json).toEqual({
      type: "house-keeping.sync-status-changed",
      payload: { syncing: true },
    });

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
    const json = JSON.parse(text.replace("data: ", "").trim());
    expect(json).toEqual({
      type: "house-keeping.sync-status-changed",
      payload: { syncing: true },
    });

    await reader.cancel();
  });

  it("streams process.status-changed events with correct org/name from event payload", async () => {
    // Clear any latched state from previous tests
    eventBus.removeAllListeners();

    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    eventBus.emit("process.status-changed", {
      processId: "p1",
      worktreeBranch: "feat/test",
      worktreePath: "/some/deep/path/to/worktrees/feat/test",
      status: "running",
      repositoryOrganization: "my-org",
      repositoryName: "my-repo",
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    const json = JSON.parse(text.replace("data: ", "").trim());
    expect(json).toEqual({
      type: "process.status-changed",
      payload: {
        repositoryOrganization: "my-org",
        repositoryName: "my-repo",
        worktreeBranch: "feat/test",
        processId: "p1",
        status: "running",
      },
    });

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
