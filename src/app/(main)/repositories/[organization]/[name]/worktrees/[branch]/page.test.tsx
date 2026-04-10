// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/utils/api";

const {
  mockFetchRepository,
  mockFetchWorktrees,
  mockRemoveWorktree,
  mockFetchWorkflows,
  mockFetchWorkflowRuns,
} = vi.hoisted(() => ({
  mockFetchRepository: vi.fn(),
  mockFetchWorktrees: vi.fn(),
  mockRemoveWorktree: vi.fn(),
  mockFetchWorkflows: vi.fn(),
  mockFetchWorkflowRuns: vi.fn(),
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchRepository: mockFetchRepository,
    fetchWorktrees: mockFetchWorktrees,
    removeWorktree: mockRemoveWorktree,
    fetchWorkflows: mockFetchWorkflows,
    fetchWorkflowRuns: mockFetchWorkflowRuns,
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({
    organization: "org",
    name: "repo",
    branch: "feature__my-branch",
  }),
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

import { SWRTestProvider } from "@/test-swr-provider";
import WorktreePage from "./page";

const repo = {
  path: "/repos/org/repo",
  name: "repo",
  alias: "org/repo",
  github_url: null,
};

const worktree = {
  path: "/repos/org/repo/worktrees/feature/my-branch",
  branch: "feature/my-branch",
  head: "abc1234",
  is_main: false,
  is_bare: false,
};

beforeEach(() => {
  mockFetchRepository.mockResolvedValue(repo);
  mockFetchWorktrees.mockResolvedValue([worktree]);
  mockFetchWorkflows.mockResolvedValue({});
  mockFetchWorkflowRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreePage", () => {
  it("renders the branch name heading", async () => {
    render(
      <SWRTestProvider>
        <WorktreePage />
      </SWRTestProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "feature/my-branch" }),
    ).toBeInTheDocument();
  });

  it("renders the remove button for non-main worktrees", async () => {
    render(
      <SWRTestProvider>
        <WorktreePage />
      </SWRTestProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Remove worktree" }),
    ).toBeInTheDocument();
  });

  it("does not render details section (Path, HEAD, Main, Bare)", async () => {
    render(
      <SWRTestProvider>
        <WorktreePage />
      </SWRTestProvider>,
    );
    // Wait for page to load
    await screen.findByRole("heading", { name: "feature/my-branch" });

    // Details should NOT be present
    expect(screen.queryByText("Path")).not.toBeInTheDocument();
    expect(screen.queryByText("HEAD")).not.toBeInTheDocument();
    expect(screen.queryByText("Main")).not.toBeInTheDocument();
    expect(screen.queryByText("Bare")).not.toBeInTheDocument();
  });

  it("renders the WorkflowKanbanBoard", async () => {
    render(
      <SWRTestProvider>
        <WorktreePage />
      </SWRTestProvider>,
    );
    // The kanban board renders a "Workflow Runs" heading
    expect(
      await screen.findByRole("heading", { name: "Workflow Runs" }),
    ).toBeInTheDocument();
  });

  it("shows an error instead of 404 for non-404 repository failures", async () => {
    mockFetchRepository.mockRejectedValue(
      new ApiError("Repository unavailable", 500),
    );

    render(
      <SWRTestProvider>
        <WorktreePage />
      </SWRTestProvider>,
    );

    expect(
      await screen.findByText("Repository unavailable"),
    ).toBeInTheDocument();
  });
});
