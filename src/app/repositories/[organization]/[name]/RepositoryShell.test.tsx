// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchRepository = vi.fn();
const mockFetchWorkflowRuns = vi.fn();
const mockFetchRepositories = vi.fn();
const mockFetchWorkflows = vi.fn();
const mockGenerateBranchName = vi.fn();
const mockCreateWorkflowRun = vi.fn();
const mockCreateWorktree = vi.fn();
const mockFetchWorktrees = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorkflowRuns: (...args: unknown[]) => mockFetchWorkflowRuns(...args),
  fetchRepositories: (...args: unknown[]) => mockFetchRepositories(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  generateBranchName: (...args: unknown[]) => mockGenerateBranchName(...args),
  createWorkflowRun: (...args: unknown[]) => mockCreateWorkflowRun(...args),
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
  cleanMergedWorktrees: vi.fn().mockResolvedValue(undefined),
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/repositories/org/repo",
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
import RepositoryShell from "./RepositoryShell";

const repo = {
  path: "/repos/org/repo",
  name: "repo",
  alias: "org/repo",
  github_url: null,
};

beforeEach(() => {
  mockFetchRepository.mockResolvedValue(repo);
  mockFetchWorkflowRuns.mockResolvedValue([]);
  mockFetchWorktrees.mockResolvedValue([]);
  mockFetchRepositories.mockResolvedValue([repo]);
  mockFetchWorkflows.mockResolvedValue({
    default: { inputs: [] },
  });
  mockGenerateBranchName.mockResolvedValue({
    branch: "new-branch",
  });
  mockCreateWorktree.mockResolvedValue({
    branch: "new-branch",
    path: "/repos/org/repo/worktrees/new-branch",
  });
  mockCreateWorkflowRun.mockResolvedValue({
    id: "run-new",
    repository_path: "/repos/org/repo",
    worktree_branch: "new-branch",
    workflow_name: "default",
    status: "running",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RepositoryShell", () => {
  it("calls create APIs after RunWorkflowModal submission", async () => {
    const user = userEvent.setup();

    render(
      <SWRTestProvider>
        <RepositoryShell organization="org" name="repo">
          <div>child</div>
        </RepositoryShell>
      </SWRTestProvider>,
    );

    // Wait for initial data load
    await waitFor(() => {
      expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);
    });

    // Open modal and submit
    await user.click(screen.getByText("Run Workflow"));
    await screen.findByText("Auto-generate");
    await user.click(screen.getByText("Create & launch"));

    await waitFor(() => {
      expect(mockGenerateBranchName).toHaveBeenCalledWith("default", undefined);
      expect(mockCreateWorktree).toHaveBeenCalled();
      expect(mockCreateWorkflowRun).toHaveBeenCalled();
    });
  });

  it("renders child content", async () => {
    render(
      <SWRTestProvider>
        <RepositoryShell organization="org" name="repo">
          <div>child</div>
        </RepositoryShell>
      </SWRTestProvider>,
    );

    await waitFor(() => {
      expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
