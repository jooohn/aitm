import { describe, expect, it } from "vitest";
import { parseDiffStat } from "./parseDiffStat";

describe("parseDiffStat", () => {
  it("parses a full stat summary line", () => {
    expect(
      parseDiffStat(" 3 files changed, 15 insertions(+), 7 deletions(-)"),
    ).toEqual({ filesChanged: 3, insertions: 15, deletions: 7 });
  });

  it("parses insertions only", () => {
    expect(parseDiffStat(" 1 file changed, 10 insertions(+)")).toEqual({
      filesChanged: 1,
      insertions: 10,
      deletions: 0,
    });
  });

  it("parses deletions only", () => {
    expect(parseDiffStat(" 2 files changed, 5 deletions(-)")).toEqual({
      filesChanged: 2,
      insertions: 0,
      deletions: 5,
    });
  });

  it("parses singular forms", () => {
    expect(
      parseDiffStat(" 1 file changed, 1 insertion(+), 1 deletion(-)"),
    ).toEqual({ filesChanged: 1, insertions: 1, deletions: 1 });
  });

  it("extracts summary from multi-line stat output", () => {
    const stat = ` src/foo.ts | 10 +++++++---
 src/bar.ts |  3 +++
 2 files changed, 10 insertions(+), 3 deletions(-)`;
    expect(parseDiffStat(stat)).toEqual({
      filesChanged: 2,
      insertions: 10,
      deletions: 3,
    });
  });

  it("returns null for empty string", () => {
    expect(parseDiffStat("")).toBeNull();
  });

  it("returns null for unrecognized input", () => {
    expect(parseDiffStat("no changes")).toBeNull();
  });
});
