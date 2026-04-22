import { describe, expect, it } from "vitest";
import { parseDiff } from "./parseDiff";

describe("parseDiff", () => {
  it("parses a simple modification", () => {
    const raw = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc1234..def5678 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-line2",
      "+line2-modified",
      "+line2-extra",
      " line3",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.oldPath).toBe("src/index.ts");
    expect(file.newPath).toBe("src/index.ts");
    expect(file.status).toBe("modified");
    expect(file.isBinary).toBe(false);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(4);
    expect(hunk.lines).toHaveLength(5);

    expect(hunk.lines[0]).toEqual({
      type: "context",
      content: "line1",
      oldLineNumber: 1,
      newLineNumber: 1,
    });
    expect(hunk.lines[1]).toEqual({
      type: "removed",
      content: "line2",
      oldLineNumber: 2,
      newLineNumber: null,
    });
    expect(hunk.lines[2]).toEqual({
      type: "added",
      content: "line2-modified",
      oldLineNumber: null,
      newLineNumber: 2,
    });
    expect(hunk.lines[3]).toEqual({
      type: "added",
      content: "line2-extra",
      oldLineNumber: null,
      newLineNumber: 3,
    });
    expect(hunk.lines[4]).toEqual({
      type: "context",
      content: "line3",
      oldLineNumber: 3,
      newLineNumber: 4,
    });
  });

  it("parses a new file", () => {
    const raw = [
      "diff --git a/new-file.ts b/new-file.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/new-file.ts",
      "@@ -0,0 +1,2 @@",
      "+export const x = 1;",
      "+export const y = 2;",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.status).toBe("added");
    expect(file.oldPath).toBe("/dev/null");
    expect(file.newPath).toBe("new-file.ts");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].lines).toHaveLength(2);
    expect(file.hunks[0].lines[0].type).toBe("added");
    expect(file.hunks[0].lines[0].newLineNumber).toBe(1);
  });

  it("parses a deleted file", () => {
    const raw = [
      "diff --git a/old-file.ts b/old-file.ts",
      "deleted file mode 100644",
      "index abc1234..0000000",
      "--- a/old-file.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-const a = 1;",
      "-const b = 2;",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.status).toBe("deleted");
    expect(file.oldPath).toBe("old-file.ts");
    expect(file.newPath).toBe("/dev/null");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].lines).toHaveLength(2);
    expect(file.hunks[0].lines[0].type).toBe("removed");
    expect(file.hunks[0].lines[0].oldLineNumber).toBe(1);
  });

  it("parses a renamed file", () => {
    const raw = [
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 100%",
      "rename from old-name.ts",
      "rename to new-name.ts",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.status).toBe("renamed");
    expect(file.oldPath).toBe("old-name.ts");
    expect(file.newPath).toBe("new-name.ts");
    expect(file.hunks).toHaveLength(0);
  });

  it("parses a binary file", () => {
    const raw = [
      "diff --git a/image.png b/image.png",
      "new file mode 100644",
      "index 0000000..abc1234",
      "Binary files /dev/null and b/image.png differ",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.isBinary).toBe(true);
    expect(file.status).toBe("added");
    expect(file.hunks).toHaveLength(0);
  });

  it("parses multiple files", () => {
    const raw = [
      "diff --git a/file1.ts b/file1.ts",
      "index abc..def 100644",
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "diff --git a/file2.ts b/file2.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/file2.ts",
      "@@ -0,0 +1,1 @@",
      "+hello",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0].newPath).toBe("file1.ts");
    expect(files[0].status).toBe("modified");
    expect(files[1].newPath).toBe("file2.ts");
    expect(files[1].status).toBe("added");
  });

  it("returns empty array for empty diff", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("handles hunk headers without count (single-line)", () => {
    const raw = [
      "diff --git a/single.ts b/single.ts",
      "index abc..def 100644",
      "--- a/single.ts",
      "+++ b/single.ts",
      "@@ -1 +1 @@",
      "-old line",
      "+new line",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const hunk = files[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(1);
  });

  it("handles no-newline-at-end-of-file marker", () => {
    const raw = [
      "diff --git a/file.ts b/file.ts",
      "index abc..def 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");

    const files = parseDiff(raw);
    const hunk = files[0].hunks[0];
    expect(hunk.lines).toHaveLength(2);
    expect(hunk.lines[0].type).toBe("removed");
    expect(hunk.lines[1].type).toBe("added");
  });

  it("parses multiple hunks in a single file", () => {
    const raw = [
      "diff --git a/multi.ts b/multi.ts",
      "index abc..def 100644",
      "--- a/multi.ts",
      "+++ b/multi.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+line2-new",
      " line3",
      "@@ -10,3 +10,3 @@",
      " line10",
      "-line11",
      "+line11-new",
      " line12",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);

    expect(files[0].hunks[0].oldStart).toBe(1);
    expect(files[0].hunks[1].oldStart).toBe(10);
    expect(files[0].hunks[1].lines[1].oldLineNumber).toBe(11);
    expect(files[0].hunks[1].lines[2].newLineNumber).toBe(11);
  });
});
