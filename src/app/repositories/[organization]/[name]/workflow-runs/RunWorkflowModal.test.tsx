// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchRepositories = vi.fn();
const mockFetchRepository = vi.fn();
const mockFetchWorkflows = vi.fn();
const mockCreateWorktree = vi.fn();
const mockCreateWorkflowRun = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepositories: (...args: unknown[]) => mockFetchRepositories(...args),
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  createWorkflowRun: (...args: unknown[]) => mockCreateWorkflowRun(...args),
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import RunWorkflowModal from "./RunWorkflowModal";

const repo = {
  path: "/repos/org/repo",
  name: "repo",
  alias: "org/repo",
  github_url: null,
};

beforeEach(() => {
  mockFetchRepository.mockResolvedValue(repo);
  mockFetchRepositories.mockResolvedValue([repo]);
  mockFetchWorkflows.mockResolvedValue({
    default: { inputs: [] },
  });
  mockCreateWorktree.mockResolvedValue({
    branch: "new-branch",
    path: "/repos/org/repo/worktrees/new-branch",
  });
  mockCreateWorkflowRun.mockResolvedValue({
    id: "run-1",
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

describe("RunWorkflowModal", () => {
  it("calls onCreated callback after successful creation", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(
      <RunWorkflowModal
        onClose={onClose}
        fixedAlias="org/repo"
        onCreated={onCreated}
      />,
    );

    // Wait for the form to load
    const branchInput = await screen.findByPlaceholderText(
      "e.g. feature/my-change",
    );
    await user.type(branchInput, "new-branch");
    await user.click(screen.getByText("Create & launch"));

    // Wait for async operations to complete
    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fail when onCreated is not provided", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<RunWorkflowModal onClose={onClose} fixedAlias="org/repo" />);

    const branchInput = await screen.findByPlaceholderText(
      "e.g. feature/my-change",
    );
    await user.type(branchInput, "new-branch");
    await user.click(screen.getByText("Create & launch"));

    // Should navigate without error
    await vi.waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
  });
});
