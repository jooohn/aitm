import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "StatusDot.module.css",
);

function readCssContent(): string {
  return readFileSync(cssPath, "utf-8");
}

describe("StatusDot.module.css", () => {
  it("defines an .idle class with a neutral gray background", () => {
    const css = readCssContent();
    const match = css.match(/\.idle\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/bg-zinc-400/);
  });
});
