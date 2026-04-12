import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as containerModule from "@/backend/container";
import type { ChatService } from "@/backend/domain/chats";
import { POST } from "./route";

function makeMockChatService(overrides: Partial<ChatService> = {}) {
  return {
    diveDeep: vi.fn().mockResolvedValue({ chatId: "new-chat-id" }),
    ...overrides,
  } as unknown as ChatService;
}

function makeRequest(
  chatId: string,
  proposalId: string,
): [NextRequest, { params: Promise<{ id: string; proposalId: string }> }] {
  const req = new NextRequest(
    `http://localhost/api/chats/${chatId}/proposals/${proposalId}/dive-deep`,
    { method: "POST" },
  );
  return [req, { params: Promise.resolve({ id: chatId, proposalId }) }];
}

describe("POST /api/chats/[id]/proposals/[proposalId]/dive-deep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with the new chat ID on success", async () => {
    const chatService = makeMockChatService();
    vi.spyOn(containerModule, "getContainer").mockReturnValue({
      chatService,
    } as unknown as containerModule.Container);

    const res = await POST(...makeRequest("chat-1", "proposal-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ chat_id: "new-chat-id" });
    expect(chatService.diveDeep).toHaveBeenCalledWith("chat-1", "proposal-1");
  });

  it("returns error status when service throws a domain error", async () => {
    const { NotFoundError } = await import("@/backend/domain/errors");
    const chatService = makeMockChatService({
      diveDeep: vi.fn().mockRejectedValue(new NotFoundError("Chat", "chat-1")),
    });
    vi.spyOn(containerModule, "getContainer").mockReturnValue({
      chatService,
    } as unknown as containerModule.Container);

    const res = await POST(...makeRequest("chat-1", "proposal-1"));

    expect(res.status).toBe(404);
  });
});
