import { describe, expect, it } from "vitest";
import { inferAlias } from "./inferAlias";

describe("inferAlias", () => {
  it("returns last two path segments joined with /", () => {
    expect(inferAlias("/some/path/jooohn/aitm")).toBe("jooohn/aitm");
  });

  it("handles paths without trailing slash", () => {
    expect(inferAlias("/home/user/github.com/org/repo")).toBe("org/repo");
  });

  it("returns single segment when path has only one component", () => {
    expect(inferAlias("/repo")).toBe("repo");
  });
});
