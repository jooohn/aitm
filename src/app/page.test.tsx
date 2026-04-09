// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository, WorkflowRun } from "@/lib/utils/api";

const mockFetchRepositories = vi.fn();
const mockFetchAllWorkflowRuns = vi.fn();
const mockFetchWorkflows = vi.fn();
const mockUseHouseKeepingSyncing = vi.fn();

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchRepositories: (...args: unknown[]) => mockFetchRepositories(...args),
    fetchAllWorkflowRuns: (...args: unknown[]) =>
      mockFetchAllWorkflowRuns(...args),
    fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
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
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/hooks/useHouseKeepingSyncing", () => ({
  useHouseKeepingSyncing: () => mockUseHouseKeepingSyncing(),
}));

import { SWRTestProvider } from "@/test-swr-provider";
import Home from "./page";

const REPOS: Repository[] = [
  { path: "/repos/org/alpha", name: "alpha", alias: "org/alpha" },
  { path: "/repos/org/beta", name: "beta", alias: "org/beta" },
];

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    organization: "org",
    name: "alpha",
    worktree_branch: "feature-branch",
    workflow_name: "default",
    current_step: "plan",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockUseHouseKeepingSyncing.mockReturnValue(false);
  mockFetchRepositories.mockResolvedValue(REPOS);
  mockFetchAllWorkflowRuns.mockResolvedValue([]);
  mockFetchWorkflows.mockResolvedValue({
    default: {
      initial_step: "plan",
      steps: {
        plan: {
          goal: "Plan",
          transitions: [
            { step: "implement", when: "plan approved" },
            { terminal: "failure", when: "plan rejected" },
          ],
        },
        implement: {
          goal: "Implement",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Homepage", () => {
  describe("sidebar", () => {
    it("renders a REPOSITORIES heading", async () => {
      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      expect(
        await screen.findByRole("heading", { name: /repositories/i }),
      ).toBeInTheDocument();
    });

    it("renders repository links in the sidebar", async () => {
      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      const repoLink = await screen.findByRole("link", { name: "org/alpha" });
      expect(repoLink).toHaveAttribute("href", "/repositories/org/alpha");

      const betaLink = screen.getByRole("link", { name: "org/beta" });
      expect(betaLink).toHaveAttribute("href", "/repositories/org/beta");
    });

    it("shows empty message when no repositories configured", async () => {
      mockFetchRepositories.mockResolvedValue([]);
      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      expect(
        await screen.findByText(/no repositories configured/i),
      ).toBeInTheDocument();
    });

    it("shows a syncing indicator in the header while house-keeping is active", async () => {
      mockUseHouseKeepingSyncing.mockReturnValue(true);

      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );

      expect(
        await screen.findByTestId("repositories-sync-indicator"),
      ).toHaveAttribute("aria-label", "Repositories syncing");
    });
  });

  describe("main area", () => {
    it("renders workflow kanban board with all workflow runs", async () => {
      mockFetchAllWorkflowRuns.mockResolvedValue([
        makeRun({ id: "r1", current_step: "plan" }),
      ]);

      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      await screen.findByText("feature-branch");

      expect(
        screen.getByRole("heading", { name: "Workflow Runs" }),
      ).toBeInTheDocument();
    });

    it("fetches all workflow runs without status filter", async () => {
      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      await screen.findByRole("heading", { name: /repositories/i });

      expect(mockFetchAllWorkflowRuns).toHaveBeenCalledWith();
    });

    it("shows runs from multiple repositories", async () => {
      mockFetchAllWorkflowRuns.mockResolvedValue([
        makeRun({
          id: "r1",
          organization: "org",
          name: "alpha",
          worktree_branch: "alpha-feat",
          current_step: "plan",
        }),
        makeRun({
          id: "r2",
          organization: "org",
          name: "beta",
          worktree_branch: "beta-feat",
          current_step: "implement",
        }),
      ]);

      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      await screen.findByText("alpha-feat");
      expect(screen.getByText("beta-feat")).toBeInTheDocument();
    });
  });

  describe("layout", () => {
    it("uses a two-column grid layout", async () => {
      render(
        <SWRTestProvider>
          <Home />
        </SWRTestProvider>,
      );
      await screen.findByRole("heading", { name: /repositories/i });

      // The page should have a sidebar (aside element) and main content area
      expect(document.querySelector("aside")).toBeInTheDocument();
    });
  });
});
