// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Process } from "@/lib/utils/api";

const mockUseProcesses = vi.fn();
const mockStopProcess = vi.fn();
const mockMutate = vi.fn();

vi.mock("@/lib/hooks/swr", () => ({
  useProcesses: (...args: unknown[]) => mockUseProcesses(...args),
  swrKeys: {
    processes: (org: string, name: string, branch: string) => [
      "/api/repositories",
      org,
      name,
      "worktrees",
      branch,
      "processes",
    ],
  },
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    stopProcess: (...args: unknown[]) => mockStopProcess(...args),
  };
});

vi.mock("swr", async () => {
  const actual = await vi.importActual("swr");
  return {
    ...actual,
    mutate: (...args: unknown[]) => mockMutate(...args),
  };
});

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/repositories/org/repo/worktrees/main/processes/1",
}));

import WorktreeActiveProcesses from "./WorktreeActiveProcesses";

function makeProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: "proc-1",
    worktree_branch: "main",
    command_id: "cmd-1",
    command_label: "claude",
    command: "claude --run",
    status: "running",
    pid: 1234,
    exit_code: null,
    created_at: "2026-04-01T00:00:00Z",
    stopped_at: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeActiveProcesses", () => {
  describe("deduplication by command_id", () => {
    it("shows only the latest process per command_id", () => {
      mockUseProcesses.mockReturnValue({
        data: [
          makeProcess({
            id: "old",
            command_id: "cmd-1",
            created_at: "2026-04-01T00:00:00Z",
            status: "running",
            command_label: "claude (old)",
          }),
          makeProcess({
            id: "new",
            command_id: "cmd-1",
            created_at: "2026-04-02T00:00:00Z",
            status: "running",
            command_label: "claude (new)",
          }),
        ],
      });

      render(
        <WorktreeActiveProcesses
          organization="org"
          name="repo"
          branch="main"
        />,
      );

      expect(screen.getByText("claude (new)")).toBeInTheDocument();
      expect(screen.queryByText("claude (old)")).not.toBeInTheDocument();
    });

    it("shows processes with different command_ids separately", () => {
      mockUseProcesses.mockReturnValue({
        data: [
          makeProcess({
            id: "p1",
            command_id: "cmd-1",
            command_label: "claude",
            status: "running",
          }),
          makeProcess({
            id: "p2",
            command_id: "cmd-2",
            command_label: "test",
            status: "crashed",
          }),
        ],
      });

      render(
        <WorktreeActiveProcesses
          organization="org"
          name="repo"
          branch="main"
        />,
      );

      expect(screen.getByText("claude")).toBeInTheDocument();
      expect(screen.getByText("test")).toBeInTheDocument();
    });
  });

  describe("stop button", () => {
    it("renders a stop button for running processes", () => {
      mockUseProcesses.mockReturnValue({
        data: [makeProcess({ id: "p1", status: "running" })],
      });

      render(
        <WorktreeActiveProcesses
          organization="org"
          name="repo"
          branch="main"
        />,
      );

      expect(
        screen.getByRole("button", { name: "Stop process" }),
      ).toBeInTheDocument();
    });

    it("does not render a stop button for crashed processes", () => {
      mockUseProcesses.mockReturnValue({
        data: [makeProcess({ id: "p1", status: "crashed" })],
      });

      render(
        <WorktreeActiveProcesses
          organization="org"
          name="repo"
          branch="main"
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Stop process" }),
      ).not.toBeInTheDocument();
    });

    it("logs error and re-enables button when stopProcess rejects", async () => {
      const user = userEvent.setup();
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockStopProcess.mockRejectedValue(new Error("network failure"));
      mockUseProcesses.mockReturnValue({
        data: [makeProcess({ id: "p1", status: "running" })],
      });

      render(
        <WorktreeActiveProcesses
          organization="org"
          name="repo"
          branch="main"
        />,
      );

      const stopButton = screen.getByRole("button", { name: "Stop process" });
      await user.click(stopButton);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to stop process:",
        expect.any(Error),
      );
      // Button should be re-enabled after error
      expect(stopButton).not.toBeDisabled();
    });

    it("calls stopProcess and mutates SWR cache when clicked", async () => {
      const user = userEvent.setup();
      mockStopProcess.mockResolvedValue({});
      mockMutate.mockResolvedValue(undefined);
      mockUseProcesses.mockReturnValue({
        data: [makeProcess({ id: "p1", status: "running" })],
      });

      render(
        <WorktreeActiveProcesses
          organization="org"
          name="repo"
          branch="main"
        />,
      );

      const stopButton = screen.getByRole("button", { name: "Stop process" });
      await user.click(stopButton);

      expect(mockStopProcess).toHaveBeenCalledWith("org", "repo", "main", "p1");
      expect(mockMutate).toHaveBeenCalledWith([
        "/api/repositories",
        "org",
        "repo",
        "worktrees",
        "main",
        "processes",
      ]);
    });
  });
});
