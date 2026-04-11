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
const mockFetchRemoteBranches = vi.fn();
const mockFetchWorktrees = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepositories: (...args: unknown[]) => mockFetchRepositories(...args),
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  generateBranchName: (...args: unknown[]) => mockGenerateBranchName(...args),
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  createWorkflowRun: (...args: unknown[]) => mockCreateWorkflowRun(...args),
  fetchRemoteBranches: (...args: unknown[]) => mockFetchRemoteBranches(...args),
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
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
    organization: "org",
    name: "repo",
    worktree_branch: "new-branch",
    workflow_name: "default",
    status: "running",
  });
  mockFetchRemoteBranches.mockResolvedValue([
    {
      branch: "feature/remote-work",
      pr_number: 99,
      pr_title: "Remote work feature",
    },
    {
      branch: "fix/existing-bug",
      pr_number: 50,
      pr_title: "Fix existing bug",
    },
  ]);
  mockFetchWorktrees.mockResolvedValue([
    {
      branch: "main",
      path: "/repos/org/repo",
      is_main: true,
      is_bare: false,
      head: "abc123",
    },
  ]);
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

  it("uses the fixed branch for suggested workflow launches", async () => {
    const user = userEvent.setup();

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

    await screen.findByText("feature/existing-pr");
    await user.click(screen.getByText("Create & launch"));

    await vi.waitFor(() => {
      expect(mockGenerateBranchName).not.toHaveBeenCalled();
      expect(mockCreateWorktree).not.toHaveBeenCalled();
      expect(mockCreateWorkflowRun).toHaveBeenCalledWith({
        organization: "org",
        name: "repo",
        worktree_branch: "feature/existing-pr",
        workflow_name: "maintain-pr",
        inputs: {
          "pr-url": "https://github.com/org/repo/pull/42",
        },
      });
    });
  });

  describe("import remote branch mode", () => {
    it("shows import remote branch button when not in fixedBranch mode", async () => {
      render(<RunWorkflowModal onClose={vi.fn()} fixedAlias="org/repo" />);

      await screen.findByText("Auto-generate");
      expect(
        screen.getByRole("button", { name: /import remote branch/i }),
      ).toBeInTheDocument();
    });

    it("does not show import remote branch button when fixedBranch is set", async () => {
      render(
        <RunWorkflowModal
          onClose={vi.fn()}
          fixedAlias="org/repo"
          fixedBranch="feature/existing"
        />,
      );

      await screen.findByText("feature/existing");
      expect(
        screen.queryByRole("button", { name: /import remote branch/i }),
      ).not.toBeInTheDocument();
    });

    it("fetches and displays remote branches when import button is clicked", async () => {
      const user = userEvent.setup();

      render(<RunWorkflowModal onClose={vi.fn()} fixedAlias="org/repo" />);

      await screen.findByText("Auto-generate");
      await user.click(
        screen.getByRole("button", { name: /import remote branch/i }),
      );

      await vi.waitFor(() => {
        expect(mockFetchRemoteBranches).toHaveBeenCalledWith("org", "repo");
        expect(mockFetchWorktrees).toHaveBeenCalledWith("org", "repo");
      });

      // Should show a select dropdown with remote branches
      const select = await screen.findByRole("combobox", {
        name: /branch/i,
      });
      expect(select).toBeInTheDocument();

      // Verify branch options are displayed (excluding branches that already have worktrees)
      const options = select.querySelectorAll("option");
      // "main" is already a local worktree, so only the two remote branches should show
      expect(
        Array.from(options).some((o) =>
          o.textContent?.includes("feature/remote-work"),
        ),
      ).toBe(true);
      expect(
        Array.from(options).some((o) =>
          o.textContent?.includes("fix/existing-bug"),
        ),
      ).toBe(true);
    });

    it("filters out branches that already exist as local worktrees", async () => {
      const user = userEvent.setup();

      mockFetchWorktrees.mockResolvedValue([
        {
          branch: "main",
          path: "/repos/org/repo",
          is_main: true,
          is_bare: false,
          head: "abc123",
        },
        {
          branch: "feature/remote-work",
          path: "/repos/org/repo/worktrees/feature/remote-work",
          is_main: false,
          is_bare: false,
          head: "def456",
        },
      ]);

      render(<RunWorkflowModal onClose={vi.fn()} fixedAlias="org/repo" />);

      await screen.findByText("Auto-generate");
      await user.click(
        screen.getByRole("button", { name: /import remote branch/i }),
      );

      const select = await screen.findByRole("combobox", {
        name: /branch/i,
      });

      const options = select.querySelectorAll("option");
      const branchTexts = Array.from(options).map((o) => o.textContent);

      // feature/remote-work should be filtered out since it's already a local worktree
      expect(branchTexts.some((t) => t?.includes("feature/remote-work"))).toBe(
        false,
      );
      // fix/existing-bug should still be available
      expect(branchTexts.some((t) => t?.includes("fix/existing-bug"))).toBe(
        true,
      );
    });

    it("submits with the selected remote branch", async () => {
      const user = userEvent.setup();

      mockCreateWorktree.mockResolvedValue({
        branch: "feature/remote-work",
        path: "/repos/org/repo/worktrees/feature/remote-work",
      });
      mockCreateWorkflowRun.mockResolvedValue({
        id: "run-2",
        organization: "org",
        name: "repo",
        worktree_branch: "feature/remote-work",
        workflow_name: "default",
        status: "running",
      });

      render(<RunWorkflowModal onClose={vi.fn()} fixedAlias="org/repo" />);

      await screen.findByText("Auto-generate");
      await user.click(
        screen.getByRole("button", { name: /import remote branch/i }),
      );

      // Wait for the select to appear and select a branch
      const select = await screen.findByRole("combobox", {
        name: /branch/i,
      });
      await user.selectOptions(select, "feature/remote-work");

      await user.click(screen.getByText("Create & launch"));

      await vi.waitFor(() => {
        // Should NOT generate a branch name
        expect(mockGenerateBranchName).not.toHaveBeenCalled();
        // Should create a worktree with the selected remote branch
        expect(mockCreateWorktree).toHaveBeenCalledWith("org", "repo", {
          branch: "feature/remote-work",
        });
        // Should create a workflow run with the selected branch
        expect(mockCreateWorkflowRun).toHaveBeenCalledWith({
          organization: "org",
          name: "repo",
          worktree_branch: "feature/remote-work",
          workflow_name: "default",
          inputs: undefined,
        });
      });
    });

    it("clears stale branch when entering import mode and all branches are filtered out", async () => {
      const user = userEvent.setup();

      // All remote branches already exist as local worktrees
      mockFetchWorktrees.mockResolvedValue([
        {
          branch: "main",
          path: "/repos/org/repo",
          is_main: true,
          is_bare: false,
          head: "abc123",
        },
        {
          branch: "feature/remote-work",
          path: "/repos/org/repo/worktrees/feature/remote-work",
          is_main: false,
          is_bare: false,
          head: "def456",
        },
        {
          branch: "fix/existing-bug",
          path: "/repos/org/repo/worktrees/fix/existing-bug",
          is_main: false,
          is_bare: false,
          head: "ghi789",
        },
      ]);

      render(<RunWorkflowModal onClose={vi.fn()} fixedAlias="org/repo" />);

      await screen.findByText("Auto-generate");

      // Uncheck auto-generate and type a manual branch name
      await user.click(screen.getByLabelText("Auto-generate"));
      const branchInput = screen.getByPlaceholderText("e.g. feature/my-change");
      await user.type(branchInput, "my-manual-branch");
      expect(branchInput).toHaveValue("my-manual-branch");

      // Now enter import mode — all remote branches are already local worktrees
      await user.click(
        screen.getByRole("button", { name: /import remote branch/i }),
      );

      // Wait for the loading to complete
      await vi.waitFor(() => {
        expect(mockFetchRemoteBranches).toHaveBeenCalled();
      });

      // The submit button should be disabled because branch should be cleared
      // (no available remote branches to select)
      const submitButton = screen.getByRole("button", {
        name: /create & launch/i,
      });
      expect(submitButton).toBeDisabled();
    });

    it("can toggle back to auto-generate mode", async () => {
      const user = userEvent.setup();

      render(<RunWorkflowModal onClose={vi.fn()} fixedAlias="org/repo" />);

      await screen.findByText("Auto-generate");

      // Enter import mode
      await user.click(
        screen.getByRole("button", { name: /import remote branch/i }),
      );

      // Wait for select to appear
      await screen.findByRole("combobox", { name: /branch/i });

      // Toggle back by clicking "Back to auto-generate" button
      await user.click(
        screen.getByRole("button", { name: /back to auto-generate/i }),
      );

      // Should be back in auto-generate mode, text input should be disabled
      const branchInput = screen.getByPlaceholderText(
        /will be generated automatically/i,
      );
      expect(branchInput).toBeDisabled();
    });
  });
});
