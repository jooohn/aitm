import { describe, expect, it } from "vitest";
import { type DiffFile, parseDiff } from "./diff";

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("parses a single file with one hunk", () => {
    const raw = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc1234..def5678 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,4 @@",
      " import { foo } from './foo';",
      "-const bar = 1;",
      "+const bar = 2;",
      "+const baz = 3;",
      " export { foo };",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/index.ts");
    expect(result[0].status).toBe("modified");
    expect(result[0].hunks).toHaveLength(1);

    const hunk = result[0].hunks[0];
    expect(hunk.header).toBe("@@ -1,3 +1,4 @@");
    expect(hunk.lines).toEqual([
      {
        type: "context",
        content: " import { foo } from './foo';",
        oldLine: 1,
        newLine: 1,
      },
      {
        type: "removed",
        content: "-const bar = 1;",
        oldLine: 2,
        newLine: null,
      },
      { type: "added", content: "+const bar = 2;", oldLine: null, newLine: 2 },
      { type: "added", content: "+const baz = 3;", oldLine: null, newLine: 3 },
      { type: "context", content: " export { foo };", oldLine: 3, newLine: 4 },
    ]);
  });

  it("parses multiple files", () => {
    const raw = [
      "diff --git a/file1.ts b/file1.ts",
      "index abc1234..def5678 100644",
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1,2 +1,2 @@",
      "-old line",
      "+new line",
      " unchanged",
      "diff --git a/file2.ts b/file2.ts",
      "index 1234567..89abcde 100644",
      "--- a/file2.ts",
      "+++ b/file2.ts",
      "@@ -1 +1 @@",
      "-removed",
      "+added",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("file1.ts");
    expect(result[1].path).toBe("file2.ts");
  });

  it("parses new file", () => {
    const raw = [
      "diff --git a/newfile.ts b/newfile.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/newfile.ts",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("newfile.ts");
    expect(result[0].status).toBe("added");
  });

  it("parses deleted file", () => {
    const raw = [
      "diff --git a/removed.ts b/removed.ts",
      "deleted file mode 100644",
      "index abc1234..0000000",
      "--- a/removed.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line one",
      "-line two",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("removed.ts");
    expect(result[0].status).toBe("deleted");
  });

  it("parses multiple hunks in one file", () => {
    const raw = [
      "diff --git a/multi.ts b/multi.ts",
      "index abc1234..def5678 100644",
      "--- a/multi.ts",
      "+++ b/multi.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-old2",
      "+new2",
      " line3",
      "@@ -10,3 +10,3 @@",
      " line10",
      "-old11",
      "+new11",
      " line12",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].hunks[0].header).toBe("@@ -1,3 +1,3 @@");
    expect(result[0].hunks[1].header).toBe("@@ -10,3 +10,3 @@");
  });

  it("handles renamed file", () => {
    const raw = [
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 95%",
      "rename from old-name.ts",
      "rename to new-name.ts",
      "index abc1234..def5678 100644",
      "--- a/old-name.ts",
      "+++ b/new-name.ts",
      "@@ -1,2 +1,2 @@",
      "-old content",
      "+new content",
      " same line",
    ].join("\n");

    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("new-name.ts");
    expect(result[0].status).toBe("renamed");
    expect(result[0].oldPath).toBe("old-name.ts");
  });
});
