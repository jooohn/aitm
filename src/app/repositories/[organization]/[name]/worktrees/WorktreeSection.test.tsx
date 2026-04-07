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

import WorktreeSection from "./WorktreeSection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockFetchWorktrees.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeSection", () => {
  it("re-fetches worktrees when refreshKey changes", async () => {
    mockFetchWorktrees
      .mockResolvedValueOnce([{ branch: "main", path: "/p/main" }])
      .mockResolvedValueOnce([
        { branch: "main", path: "/p/main" },
        { branch: "feature", path: "/p/feature" },
      ]);

    const { rerender } = render(
      <WorktreeSection organization="org" name="repo" refreshKey={0} />,
    );

    await screen.findByText("main");
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);

    rerender(<WorktreeSection organization="org" name="repo" refreshKey={1} />);

    await screen.findByText("feature");
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(2);
  });

  it("does not re-fetch when refreshKey stays the same", async () => {
    mockFetchWorktrees.mockResolvedValue([{ branch: "main", path: "/p/main" }]);

    const { rerender } = render(
      <WorktreeSection organization="org" name="repo" refreshKey={0} />,
    );

    await screen.findByText("main");
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);

    rerender(<WorktreeSection organization="org" name="repo" refreshKey={0} />);

    // Should not trigger another fetch
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);
  });

  it("keeps rendered worktrees visible during refreshes after the first load", async () => {
    const nextLoad = deferred<Array<{ branch: string; path: string }>>();
    mockFetchWorktrees
      .mockResolvedValueOnce([{ branch: "main", path: "/p/main" }])
      .mockReturnValueOnce(nextLoad.promise);

    const { rerender } = render(
      <WorktreeSection organization="org" name="repo" refreshKey={0} />,
    );

    await screen.findByText("main");

    rerender(<WorktreeSection organization="org" name="repo" refreshKey={1} />);

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    nextLoad.resolve([{ branch: "main", path: "/p/main" }]);
  });
});
