import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "RepositoryShell.module.css",
);

function readCssContent(): string {
  return readFileSync(cssPath, "utf-8");
}

function readBlock(selector: string): string {
  const css = readCssContent();
  const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`));
  expect(match).not.toBeNull();
  return match![1];
}

describe("RepositoryShell.module.css", () => {
  it(".content should not apply its own padding (child pages handle their own padding)", () => {
    const contentBody = readBlock(".content");

    // Should not contain any padding utilities
    expect(contentBody).not.toMatch(/\bpx-/);
    expect(contentBody).not.toMatch(/\bpy-/);
    expect(contentBody).not.toMatch(/\bpadding/);
  });

  it("keeps the repository sidebar header shrink-safe on narrow screens", () => {
    const leftPaneBody = readBlock(".leftPane");
    const headingRowBody = readBlock(".headingRow");
    const headingBody = readBlock(".heading");
    const headingLinkBody = readBlock(".headingLink");
    const githubLinkBody = readBlock(".githubLink");

    expect(leftPaneBody).toContain("min-w-0");
    expect(headingRowBody).toContain("min-w-0");
    expect(headingBody).toContain("min-w-0");
    expect(headingBody).toContain("flex-1");
    expect(headingLinkBody).toContain("block");
    expect(headingLinkBody).toContain("truncate");
    expect(githubLinkBody).toContain("shrink-0");
  });
});
