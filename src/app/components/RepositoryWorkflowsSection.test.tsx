// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "@/lib/utils/api";
import RepositoryWorkflowsSection from "./RepositoryWorkflowsSection";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    repository_path: "/tmp/repo",
    worktree_branch: "feat/test",
    workflow_name: "my-flow",
    current_step: null,
    status: "success",
    inputs: null,
    metadata: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:05:00Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RepositoryWorkflowsSection", () => {
  it("renders a PR link when a workflow run has a pull request URL in metadata", async () => {
    const runs: WorkflowRun[] = [
      makeRun({
        metadata: JSON.stringify({
          presets__pull_request_url: "https://github.com/org/repo/pull/42",
        }),
      }),
    ];
    vi.spyOn(
      await import("@/lib/utils/api"),
      "fetchWorkflowRuns",
    ).mockResolvedValue(runs);

    render(
      <RepositoryWorkflowsSection
        repositoryPath="/tmp/repo"
        activeWorktreeBranches={null}
      />,
    );

    const prLink = await screen.findByRole("link", { name: /PR/ });
    expect(prLink).toBeInTheDocument();
    expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/org/repo/pull/42",
    );
    // Separator should be outside the link, not inside
    expect(prLink.textContent).not.toContain("·");
  });

  it("does not render a PR link when metadata is null", async () => {
    const runs: WorkflowRun[] = [makeRun({ metadata: null })];
    vi.spyOn(
      await import("@/lib/utils/api"),
      "fetchWorkflowRuns",
    ).mockResolvedValue(runs);

    render(
      <RepositoryWorkflowsSection
        repositoryPath="/tmp/repo"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("my-flow");
    expect(screen.queryByRole("link", { name: /PR/ })).not.toBeInTheDocument();
  });
});
