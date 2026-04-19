import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function readBlock(css: string, selector: string) {
  const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`));
  expect(match).not.toBeNull();
  return match![1];
}

describe("mobile layout plan", () => {
  it("keeps the home sidebar stacked on mobile and sticky only on desktop", () => {
    const css = read("src/app/(main)/page.module.css");

    expect(css).toContain(
      "@apply w-full min-w-0 max-w-full flex-1 grid lg:grid-cols-[16rem_minmax(0,1fr)] overflow-x-hidden;",
    );
    expect(css).toContain(
      "@apply border-b border-zinc-200 dark:border-zinc-800 px-4 py-4 flex flex-col gap-4 lg:border-b-0 lg:border-r sm:px-5 sm:py-6 lg:sticky lg:top-[var(--header-h,49px)] lg:h-[calc(100vh-var(--header-h,49px))] lg:overflow-y-auto;",
    );
  });

  it("stacks repository and todo split panes on mobile", () => {
    const repositoryCss = read(
      "src/app/(main)/repositories/[organization]/[name]/RepositoryShell.module.css",
    );
    const todosCss = read("src/app/(main)/todos/page.module.css");

    expect(repositoryCss).toContain(
      "@apply min-w-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-4 flex flex-col gap-4 lg:border-b-0 lg:border-r sm:px-5 sm:py-6 lg:sticky lg:top-[var(--header-h,49px)] lg:h-[calc(100vh-var(--header-h,49px))] lg:overflow-y-auto;",
    );
    expect(todosCss).toContain(
      "@apply border-b border-zinc-200 dark:border-zinc-800 px-4 py-4 flex flex-col gap-4 lg:border-b-0 lg:border-r sm:px-5 sm:py-6 lg:sticky lg:top-[var(--header-h,49px)] lg:h-[calc(100vh-var(--header-h,49px))] lg:overflow-y-auto;",
    );
    expect(todosCss).toContain(
      "@apply min-w-0 px-4 py-4 flex flex-col gap-4 sm:px-6 sm:py-6;",
    );
  });

  it("keeps the repository sidebar alias from widening the mobile pane", () => {
    const repositoryCss = read(
      "src/app/(main)/repositories/[organization]/[name]/RepositoryShell.module.css",
    );
    const leftPaneBody = readBlock(repositoryCss, ".leftPane");
    const headingRowBody = readBlock(repositoryCss, ".headingRow");
    const headingBody = readBlock(repositoryCss, ".heading");
    const headingLinkBody = readBlock(repositoryCss, ".headingLink");
    const githubLinkBody = readBlock(repositoryCss, ".githubLink");

    expect(leftPaneBody).toContain("min-w-0");
    expect(headingRowBody).toContain("min-w-0");
    expect(headingBody).toContain("min-w-0");
    expect(headingBody).toContain("flex-1");
    expect(headingLinkBody).toContain("block");
    expect(headingLinkBody).toContain("truncate");
    expect(githubLinkBody).toContain("shrink-0");
  });

  it("adds responsive wrapping to dense headers and actions", () => {
    const headerCss = read("src/app/components/Header.module.css");
    const workflowRunCss = read(
      "src/app/(main)/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail.module.css",
    );
    const worktreeCss = read(
      "src/app/(main)/repositories/[organization]/[name]/worktrees/[branch]/page.module.css",
    );

    expect(headerCss).toContain(
      "@apply flex items-center justify-between px-4 sm:px-6 h-[var(--header-h)] shrink-0;",
    );
    expect(workflowRunCss).toContain(
      "@apply flex flex-col items-start gap-4 lg:flex-row lg:items-start lg:justify-between;",
    );
    expect(workflowRunCss).toContain(
      "@apply flex flex-wrap items-start gap-2;",
    );
    expect(workflowRunCss).toContain(
      "@apply flex flex-wrap items-center gap-2;",
    );
    expect(worktreeCss).toContain(
      "@apply flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4;",
    );
  });

  it("tunes drawer and kanban spacing for narrow screens", () => {
    const drawerCss = read("src/app/(main)/sessions/SessionDrawer.module.css");
    const kanbanCss = read(
      "src/app/(main)/workflows/WorkflowKanbanBoard.module.css",
    );

    expect(drawerCss).toContain(
      "@apply relative w-full h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-2xl flex flex-col sm:max-w-2xl;",
    );
    expect(drawerCss).toContain(
      "@apply flex items-center justify-between px-4 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0 sm:px-6;",
    );
    expect(drawerCss).toContain(
      "@apply flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6;",
    );
    expect(kanbanCss).toContain(
      "@apply overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0;",
    );
  });
});
