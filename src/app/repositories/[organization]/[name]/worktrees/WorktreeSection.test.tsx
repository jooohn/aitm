// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchWorktrees = vi.fn();

vi.mock("@/lib/utils/api", () => ({
  fetchWorktrees: (...args: unknown[]) => mockFetchWorktrees(...args),
  createWorktree: vi.fn().mockResolvedValue({ branch: "b", path: "/p" }),
  cleanMergedWorktrees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
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
import WorktreeSection from "./WorktreeSection";

beforeEach(() => {
  mockFetchWorktrees.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeSection", () => {
  it("fetches worktrees on mount", async () => {
    mockFetchWorktrees.mockResolvedValue([{ branch: "main", path: "/p/main" }]);

    render(
      <SWRTestProvider>
        <WorktreeSection organization="org" name="repo" />
      </SWRTestProvider>,
    );

    await screen.findByText("main");
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);
  });

  it("keeps rendered worktrees visible during revalidation", async () => {
    mockFetchWorktrees.mockResolvedValue([{ branch: "main", path: "/p/main" }]);

    render(
      <SWRTestProvider>
        <WorktreeSection organization="org" name="repo" />
      </SWRTestProvider>,
    );

    await screen.findByText("main");

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
