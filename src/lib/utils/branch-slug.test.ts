import { describe, expect, it } from "vitest";
import { branchToSlug, slugToBranch } from "./branch-slug";

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

describe("slugToBranch", () => {
  it("replaces __ with /", () => {
    expect(slugToBranch("feat__add-dark-mode")).toBe("feat/add-dark-mode");
  });

  it("handles multiple separators", () => {
    expect(slugToBranch("feat__ui__add-dark-mode")).toBe(
      "feat/ui/add-dark-mode",
    );
  });

  it("is the inverse of branchToSlug for typical branches", () => {
    const samples = ["main", "feat/x", "release/1.2/hotfix", ""];
    for (const sample of samples) {
      expect(slugToBranch(branchToSlug(sample))).toBe(sample);
    }
  });
});
