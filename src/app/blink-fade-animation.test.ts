import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const appDir = join(__dirname);

function readCss(relativePath: string): string {
  return readFileSync(join(appDir, relativePath), "utf-8");
}

describe("blink-fade animation", () => {
  it("does NOT define @keyframes blink-fade in globals.css (must be local to each module)", () => {
    const css = readCss("globals.css");
    expect(css).not.toContain("@keyframes blink-fade");
  });

  it("applies blink-fade animation to .running in StatusDot", () => {
    const css = readCss("components/StatusDot.module.css");
    expect(css).not.toMatch(/\.running[\s\S]*?animate-pulse/);
    expect(css).toContain("@keyframes blink-fade");
    expect(css).toMatch(
      /\.running[\s\S]*?blink-fade\s+1\.5s\s+ease-in-out\s+infinite/,
    );
  });

  it("does NOT apply blink-fade animation to .badge-running in WorkflowKanbanBoard", () => {
    const css = readCss("workflows/WorkflowKanbanBoard.module.css");
    expect(css).not.toContain("@keyframes blink-fade");
    expect(css).not.toMatch(/\.badge-running[\s\S]*?blink-fade/);
  });

  it("does NOT apply blink-fade animation to .badge-running in WorkflowSection", () => {
    const css = readCss("workflows/WorkflowSection.module.css");
    expect(css).not.toContain("@keyframes blink-fade");
    expect(css).not.toMatch(/\.badge-running[\s\S]*?blink-fade/);
  });

  it("does NOT apply blink-fade animation to .badge in ActiveWorkflowsSection", () => {
    const css = readCss("workflows/ActiveWorkflowsSection.module.css");
    expect(css).not.toContain("@keyframes blink-fade");
    expect(css).not.toMatch(/\.badge[\s\S]*?blink-fade/);
  });

  it("does NOT apply blink-fade animation to .badge-running in WorkflowRunDetail", () => {
    const css = readCss(
      "repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail.module.css",
    );
    expect(css).not.toContain("@keyframes blink-fade");
    expect(css).not.toMatch(/\.badge-running[\s\S]*?blink-fade/);
  });

  it("does NOT apply blink-fade animation to .badge-running in step-executions page", () => {
    const css = readCss(
      "repositories/[organization]/[name]/workflow-runs/[id]/step-executions/[executionId]/page.module.css",
    );
    expect(css).not.toContain("@keyframes blink-fade");
    expect(css).not.toMatch(/\.badge-running[\s\S]*?blink-fade/);
  });

  it("does NOT change .nodeCurrent animation in WorkflowStepDiagram", () => {
    const css = readCss(
      "repositories/[organization]/[name]/workflow-runs/[id]/WorkflowStepDiagram.module.css",
    );
    expect(css).not.toMatch(/\.nodeCurrent[\s\S]*?blink-fade/);
  });
});
