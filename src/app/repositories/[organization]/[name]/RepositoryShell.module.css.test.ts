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

describe("RepositoryShell.module.css", () => {
  it(".content should not apply its own padding (child pages handle their own padding)", () => {
    const css = readCssContent();
    // Extract the .content block
    const contentMatch = css.match(/\.content\s*\{([^}]+)\}/);
    expect(contentMatch).not.toBeNull();
    const contentBody = contentMatch![1];

    // Should not contain any padding utilities
    expect(contentBody).not.toMatch(/\bpx-/);
    expect(contentBody).not.toMatch(/\bpy-/);
    expect(contentBody).not.toMatch(/\bpadding/);
  });
});
