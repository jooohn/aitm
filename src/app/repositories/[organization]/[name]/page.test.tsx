// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchRepository = vi.fn();
const mockFetchWorktrees = vi.fn();
const mockFetchWorkflows = vi.fn();
const mockFetchWorkflowRuns = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  fetchWorkflowRuns: (...args: unknown[]) => mockFetchWorkflowRuns(...args),
}));

let notificationCallback: (() => void) | null = null;
vi.mock("@/lib/hooks/useNotificationStream", () => ({
  useNotificationStream: (cb: () => void) => {
    notificationCallback = cb;
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ organization: "org", name: "repo" }),
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

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

import RepositoryPage from "./page";

beforeEach(() => {
  mockFetchRepository.mockResolvedValue({
    path: "/repos/org/repo",
    name: "repo",
    alias: "org/repo",
    github_url: null,
  });
  mockFetchWorktrees.mockResolvedValue([]);
  mockFetchWorkflows.mockResolvedValue({
    default: {
      initial_step: "plan",
      steps: {
        plan: {
          goal: "Plan",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    },
  });
  mockFetchWorkflowRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RepositoryPage", () => {
  it("renders the workflow kanban board", async () => {
    render(<RepositoryPage />);

    expect(
      await screen.findByRole("heading", { name: "Workflow Runs" }),
    ).toBeInTheDocument();
  });

  it("re-fetches repository data and workflow runs when notification stream fires", async () => {
    render(<RepositoryPage />);

    await screen.findByRole("heading", { name: "Workflow Runs" });

    const initialRepositoryCalls = mockFetchRepository.mock.calls.length;
    const initialWorktreeCalls = mockFetchWorktrees.mock.calls.length;
    const initialWorkflowRunCalls = mockFetchWorkflowRuns.mock.calls.length;

    act(() => {
      notificationCallback?.();
    });

    await waitFor(() => {
      expect(mockFetchRepository.mock.calls.length).toBeGreaterThan(
        initialRepositoryCalls,
      );
      expect(mockFetchWorktrees.mock.calls.length).toBeGreaterThan(
        initialWorktreeCalls,
      );
      expect(mockFetchWorkflowRuns.mock.calls.length).toBeGreaterThan(
        initialWorkflowRunCalls,
      );
    });
  });
});
