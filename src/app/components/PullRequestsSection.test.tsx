// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowRun } from "@/lib/utils/api";
import PullRequestsSection from "./PullRequestsSection";

afterEach(() => {
  cleanup();
});

function makeRun(metadata: string | null): WorkflowRun {
  return {
    id: crypto.randomUUID(),
    repository_path: "org/repo",
    worktree_branch: "feature",
    workflow_name: "ci",
    current_step: null,
    status: "success",
    inputs: null,
    metadata,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("PullRequestsSection", () => {
  it("renders nothing when no runs have PR URLs", () => {
    const { container } = render(
      <PullRequestsSection
        workflowRuns={[
          makeRun(null),
          makeRun(JSON.stringify({ other: "data" })),
        ]}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders unique PR links from workflow runs", () => {
    render(
      <PullRequestsSection
        workflowRuns={[
          makeRun(
            JSON.stringify({
              presets__pull_request_url: "https://github.com/acme/app/pull/42",
            }),
          ),
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "acme/app#42" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("deduplicates PR URLs across runs", () => {
    const meta = JSON.stringify({
      presets__pull_request_url: "https://github.com/acme/app/pull/7",
    });
    render(
      <PullRequestsSection
        workflowRuns={[makeRun(meta), makeRun(meta), makeRun(meta)]}
      />,
    );
    const links = screen.getAllByRole("link", { name: "acme/app#7" });
    expect(links).toHaveLength(1);
  });
});
