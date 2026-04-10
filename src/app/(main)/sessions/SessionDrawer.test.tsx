// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/utils/api";
import SessionDrawer from "./SessionDrawer";

const mockReplace = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error("notFound");
});

let mockPathname =
  "/repositories/acme/app/workflow-runs/run-1/sessions/session-1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "session-1" }),
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
  notFound: () => mockNotFound(),
}));

vi.mock("@/lib/hooks/swr", () => ({
  useSession: vi.fn(),
}));

vi.mock("@/app/(main)/sessions/[id]/SessionDetail", () => ({
  default: ({ session }: { session: Session }) => (
    <div data-testid="session-detail">{session.goal}</div>
  ),
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    organization: "acme",
    name: "app",
    worktree_branch: "main",
    goal: "Inspect workflow run",
    transitions: [],
    transition_decision: null,
    step_name: "Review",
    workflow_name: "flow",
    workflow_run_id: "run-1",
    step_execution_id: "execution-1",
    status: "running",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    terminal_attach_command: null,
    log_file_path: "/tmp/session.log",
    claude_session_id: null,
    ...overrides,
  };
}

describe("SessionDrawer", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mockReplace.mockReset();
    mockNotFound.mockClear();
    mockPathname =
      "/repositories/acme/app/workflow-runs/run-1/sessions/session-1";

    const { useSession } = await import("@/lib/hooks/swr");
    vi.mocked(useSession).mockReturnValue({
      data: makeSession(),
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSession>);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("closes by replacing to the parent workflow-run route through the Next router", async () => {
    const historyReplaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<SessionDrawer />);

    fireEvent.click(
      screen.getByRole("button", { name: "Close session drawer" }),
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(historyReplaceStateSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(199);
    });

    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(mockReplace).toHaveBeenCalledWith(
      "/repositories/acme/app/workflow-runs/run-1",
    );
    expect(historyReplaceStateSpy).not.toHaveBeenCalled();
  });
});
