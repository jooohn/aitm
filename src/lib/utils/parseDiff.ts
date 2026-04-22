export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: DiffFileStatus;
  isBinary: boolean;
  hunks: DiffHunk[];
}

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith("diff --git ")) {
      i++;
      continue;
    }

    const file: DiffFile = {
      oldPath: "",
      newPath: "",
      status: "modified",
      isBinary: false,
      hunks: [],
    };

    // Parse "diff --git a/... b/..."
    const diffLine = lines[i];
    const gitMatch = diffLine.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitMatch) {
      file.oldPath = gitMatch[1];
      file.newPath = gitMatch[2];
    }
    i++;

    // Parse header lines until we hit a hunk or the next diff
    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      const line = lines[i];

      if (line.startsWith("new file mode")) {
        file.status = "added";
      } else if (line.startsWith("deleted file mode")) {
        file.status = "deleted";
      } else if (line.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = line.slice("rename from ".length);
      } else if (line.startsWith("rename to ")) {
        file.newPath = line.slice("rename to ".length);
      } else if (line.startsWith("Binary files")) {
        file.isBinary = true;
      } else if (line.startsWith("--- ")) {
        const path = line.slice(4);
        if (path === "/dev/null") {
          file.oldPath = "/dev/null";
        } else if (path.startsWith("a/")) {
          file.oldPath = path.slice(2);
        }
      } else if (line.startsWith("+++ ")) {
        const path = line.slice(4);
        if (path === "/dev/null") {
          file.newPath = "/dev/null";
        } else if (path.startsWith("b/")) {
          file.newPath = path.slice(2);
        }
      } else if (line.startsWith("@@")) {
        break;
      }

      i++;
    }

    // Parse hunks
    while (
      i < lines.length &&
      !lines[i].startsWith("diff --git ") &&
      lines[i].startsWith("@@")
    ) {
      const hunkHeader = lines[i];
      const hunkMatch = hunkHeader.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      );
      if (!hunkMatch) {
        i++;
        continue;
      }

      const hunk: DiffHunk = {
        header: hunkHeader,
        oldStart: Number.parseInt(hunkMatch[1], 10),
        oldCount:
          hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1,
        newStart: Number.parseInt(hunkMatch[3], 10),
        newCount:
          hunkMatch[4] !== undefined ? Number.parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };

      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      i++;

      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("diff --git ") || line.startsWith("@@")) {
          break;
        }

        if (line.startsWith("+")) {
          hunk.lines.push({
            type: "added",
            content: line.slice(1),
            oldLineNumber: null,
            newLineNumber: newLine++,
          });
        } else if (line.startsWith("-")) {
          hunk.lines.push({
            type: "removed",
            content: line.slice(1),
            oldLineNumber: oldLine++,
            newLineNumber: null,
          });
        } else if (line.startsWith(" ") || line === "") {
          // Context line or empty line within a hunk
          // An empty line at the end of the diff is not a context line
          if (line === "" && i === lines.length - 1) {
            break;
          }
          hunk.lines.push({
            type: "context",
            content: line.startsWith(" ") ? line.slice(1) : line,
            oldLineNumber: oldLine++,
            newLineNumber: newLine++,
          });
        } else if (line.startsWith("\\")) {
          // "\ No newline at end of file" — skip
        } else {
          break;
        }
        i++;
      }

      file.hunks.push(hunk);
    }

    files.push(file);
  }

  return files;
}
