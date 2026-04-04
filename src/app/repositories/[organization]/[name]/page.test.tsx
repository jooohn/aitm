// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchRepository = vi.fn();
const mockFetchWorktrees = vi.fn();
const mockFetchWorkflows = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
  fetchWorkflows: (...args: unknown[]) => mockFetchWorkflows(...args),
  fetchWorkflowRuns: vi.fn().mockResolvedValue([]),
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RepositoryPage", () => {
  it("does not render RepositoryWorkflowsSection", async () => {
    render(<RepositoryPage />);

    // Wait for the page to load
    await screen.findByRole("heading", { level: 1, name: "org/repo" });

    // RepositoryWorkflowsSection renders a heading "Workflow runs"
    // Ensure its section heading is not present
    expect(screen.queryByText("Workflow runs")).not.toBeInTheDocument();
  });

  it("does not render standalone QuickLaunchSection", async () => {
    render(<RepositoryPage />);

    await screen.findByRole("heading", { level: 1, name: "org/repo" });

    // QuickLaunchSection renders a heading "Quick launch"
    expect(screen.queryByText("Quick launch")).not.toBeInTheDocument();
  });

  it("renders a 'Launch new Workflow' pane alongside the kanban board", async () => {
    render(<RepositoryPage />);

    await screen.findByRole("heading", { level: 1, name: "org/repo" });

    // The launch form pane should have a "Launch new Workflow" heading
    expect(
      screen.getByRole("heading", { name: "Launch new Workflow" }),
    ).toBeInTheDocument();
  });
});
