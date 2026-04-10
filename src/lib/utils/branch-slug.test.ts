import { describe, expect, it } from "vitest";
import { branchToSlug } from "./branch-slug";

describe("branchToSlug", () => {
  it("replaces / with __", () => {
    expect(branchToSlug("feat/add-dark-mode")).toBe("feat__add-dark-mode");
  });

  it("handles multiple slashes", () => {
    expect(branchToSlug("feat/ui/add-dark-mode")).toBe(
      "feat__ui__add-dark-mode",
    );
  });

  it("returns branch as-is when no slashes", () => {
    expect(branchToSlug("main")).toBe("main");
  });

  it("handles empty string", () => {
    expect(branchToSlug("")).toBe("");
  });
});
