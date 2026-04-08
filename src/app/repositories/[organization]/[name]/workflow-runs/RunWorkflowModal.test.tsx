// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchRepositories = vi.fn();
const mockFetchRepository = vi.fn();
const mockFetchWorkflows = vi.fn();
const mockGenerateBranchName = vi.fn();
const mockCreateWorktree = vi.fn();
const mockCreateWorkflowRun = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepositories: (...args: unknown[]) => mockFetchRepositories(...args),
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  generateBranchName: (...args: unknown[]) => mockGenerateBranchName(...args),
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
    "maintain-pr": {
      inputs: [
        {
          name: "pr-url",
          label: "Pull Request URL",
          required: true,
        },
      ],
    },
  });
  mockGenerateBranchName.mockResolvedValue({
    branch: "new-branch",
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

    await screen.findByText("Auto-generate");
    await user.click(screen.getByText("Create & launch"));

    await vi.waitFor(() => {
      expect(mockGenerateBranchName).toHaveBeenCalledWith("default", undefined);
      expect(mockCreateWorktree).toHaveBeenCalledWith("org", "repo", {
        branch: "new-branch",
      });
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fail when onCreated is not provided", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<RunWorkflowModal onClose={onClose} fixedAlias="org/repo" />);

    await screen.findByText("Auto-generate");
    await user.click(screen.getByText("Create & launch"));

    await vi.waitFor(() => {
      expect(mockGenerateBranchName).toHaveBeenCalledWith("default", undefined);
      expect(mockPush).toHaveBeenCalled();
    });
  });

  it("prefills the selected workflow and suggested inputs", async () => {
    render(
      <RunWorkflowModal
        onClose={vi.fn()}
        fixedAlias="org/repo"
        fixedBranch="feature/existing-pr"
        initialWorkflow="maintain-pr"
        initialInputValues={{
          "pr-url": "https://github.com/org/repo/pull/42",
        }}
      />,
    );

    const workflowSelect = (await screen.findByLabelText(
      "Workflow",
    )) as HTMLSelectElement;
    expect(workflowSelect.value).toBe("maintain-pr");
    expect(
      screen.getByDisplayValue("https://github.com/org/repo/pull/42"),
    ).toBeInTheDocument();
    expect(screen.getByText("feature/existing-pr")).toBeInTheDocument();
  });
});
