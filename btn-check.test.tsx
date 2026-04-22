// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockFetchRepository = vi.fn();
const mockFetchWorkflowRuns = vi.fn();
const mockFetchWorktrees = vi.fn();
const mockFetchChats = vi.fn();
const mockUseHouseKeepingSyncing = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchRepository: (...args: unknown[]) => mockFetchRepository(...args),
  fetchWorkflowRuns: (...args: unknown[]) => mockFetchWorkflowRuns(...args),
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
  fetchChats: (...args: unknown[]) => mockFetchChats(...args),
  fetchWorkflows: vi.fn().mockResolvedValue({ default: { inputs: [] } }),
  fetchRepositories: vi.fn().mockResolvedValue([]),
  cleanMergedWorktrees: vi.fn(),
  createWorktree: vi.fn(),
  createWorkflowRun: vi.fn(),
  generateBranchName: vi.fn(),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/repositories/org/repo",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/hooks/useHouseKeepingSyncing", () => ({
  useHouseKeepingSyncing: () => mockUseHouseKeepingSyncing(),
}));

import { SWRTestProvider } from "@/test-swr-provider";
import RepositoryShell from "./src/app/(main)/repositories/[organization]/[name]/RepositoryShell";

describe("button class", () => {
  beforeEach(() => {
    mockUseHouseKeepingSyncing.mockReturnValue(false);
    mockFetchRepository.mockResolvedValue({
      path: "/x",
      name: "repo",
      alias: "org/repo",
      github_url: null,
    });
    mockFetchWorktrees.mockResolvedValue([]);
    mockFetchWorkflowRuns.mockResolvedValue([]);
    mockFetchChats.mockResolvedValue([]);
  });

  it("run workflow button has launchButton class", async () => {
    render(
      <SWRTestProvider>
        <RepositoryShell organization="org" name="repo">
          <div />
        </RepositoryShell>
      </SWRTestProvider>,
    );
    const btn = await screen.findByText("Run Workflow");
    console.log("BUTTON_CLASSNAME=", btn.className);
    expect(btn.className).toMatch(/launchButton/);
  });
});
