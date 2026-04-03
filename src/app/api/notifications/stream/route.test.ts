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

  it("streams session.status-changed events as SSE messages", async () => {
    const res = await GET(
      new Request("http://localhost/api/notifications/stream"),
    );

    // Emit event after the stream is opened
    eventBus.emit("session.status-changed", {
      sessionId: "s1",
      status: "AWAITING_INPUT",
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain("data:");
    expect(text).toContain('"sessionId":"s1"');
    expect(text).toContain('"status":"AWAITING_INPUT"');

    // Cancel to clean up
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
      "session.status-changed",
      expect.any(Function),
    );

    offSpy.mockRestore();
  });
});
