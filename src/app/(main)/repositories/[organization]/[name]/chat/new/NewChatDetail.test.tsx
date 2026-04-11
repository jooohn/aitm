// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateChat = vi.fn();
const mockSendChatMessage = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  createChat: (...args: unknown[]) => mockCreateChat(...args),
  sendChatMessage: (...args: unknown[]) => mockSendChatMessage(...args),
}));

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import NewChatDetail from "./NewChatDetail";

beforeEach(() => {
  mockCreateChat.mockResolvedValue({
    id: "chat-123",
    organization: "org",
    name: "repo",
    title: null,
    status: "idle",
    created_at: "2026-04-11T00:00:00Z",
    updated_at: "2026-04-11T00:00:00Z",
  });
  mockSendChatMessage.mockResolvedValue({
    id: "chat-123",
    organization: "org",
    name: "repo",
    title: null,
    status: "running",
    proposals: [],
    created_at: "2026-04-11T00:00:00Z",
    updated_at: "2026-04-11T00:00:00Z",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewChatDetail", () => {
  it("renders the draft chat UI with empty message area", () => {
    render(<NewChatDetail organization="org" name="repo" />);

    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(
      screen.getByText("Send a message to start the conversation..."),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Type a message..."),
    ).toBeInTheDocument();
  });

  it("creates chat and sends message on first send, then navigates to the real chat URL", async () => {
    const user = userEvent.setup();
    render(<NewChatDetail organization="org" name="repo" />);

    const textarea = screen.getByPlaceholderText("Type a message...");
    await user.type(textarea, "Hello agent");

    // Submit via Cmd+Enter
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(mockCreateChat).toHaveBeenCalledWith("org", "repo");
    });

    await waitFor(() => {
      expect(mockSendChatMessage).toHaveBeenCalledWith(
        "chat-123",
        "Hello agent",
      );
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/repositories/org/repo/chat/chat-123",
      );
    });
  });

  it("does not call createChat when message is empty", async () => {
    const user = userEvent.setup();
    render(<NewChatDetail organization="org" name="repo" />);

    // Try to submit with empty textarea
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(mockCreateChat).not.toHaveBeenCalled();
  });

  it("shows an error when createChat fails", async () => {
    mockCreateChat.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<NewChatDetail organization="org" name="repo" />);

    const textarea = screen.getByPlaceholderText("Type a message...");
    await user.type(textarea, "Hello");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    // Should not navigate
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("disables input while sending", async () => {
    // Make createChat hang to test the sending state
    let resolveCreate: (value: unknown) => void;
    mockCreateChat.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<NewChatDetail organization="org" name="repo" />);

    const textarea = screen.getByPlaceholderText("Type a message...");
    await user.type(textarea, "Hello");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(textarea).toBeDisabled();
    });

    // Resolve to clean up
    resolveCreate!({
      id: "chat-123",
      organization: "org",
      name: "repo",
      title: null,
      status: "idle",
      created_at: "2026-04-11T00:00:00Z",
      updated_at: "2026-04-11T00:00:00Z",
    });
  });
});
