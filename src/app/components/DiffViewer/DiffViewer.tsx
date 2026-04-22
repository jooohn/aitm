"use client";

import { useState } from "react";
import type { DiffFile, DiffFileStatus, DiffHunk } from "@/lib/utils/parseDiff";
import styles from "./DiffViewer.module.css";

interface Props {
  files: DiffFile[];
}

const statusLabels: Record<DiffFileStatus, string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
};

const statusStyles: Record<DiffFileStatus, string> = {
  added: styles.badgeAdded,
  deleted: styles.badgeDeleted,
  modified: styles.badgeModified,
  renamed: styles.badgeRenamed,
};

function displayPath(file: DiffFile): string {
  if (file.status === "renamed") {
    return `${file.oldPath} → ${file.newPath}`;
  }
  if (file.status === "deleted") {
    return file.oldPath;
  }
  return file.newPath;
}

function HunkView({ hunk, filePath }: { hunk: DiffHunk; filePath: string }) {
  return (
    <>
      <tr>
        <td colSpan={3} className={styles.hunkHeader}>
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((line, i) => {
        const lineClass =
          line.type === "added"
            ? styles.lineAdded
            : line.type === "removed"
              ? styles.lineRemoved
              : styles.lineContext;

        const side = line.type === "removed" ? "L" : "R";
        const lineNum =
          line.type === "removed" ? line.oldLineNumber : line.newLineNumber;

        return (
          <tr
            key={`${hunk.header}-${i}`}
            className={lineClass}
            data-line-id={`${filePath}:${lineNum}:${side}`}
          >
            <td className={styles.lineNumberOld}>{line.oldLineNumber ?? ""}</td>
            <td className={styles.lineNumberNew}>{line.newLineNumber ?? ""}</td>
            <td className={styles.lineContent}>{line.content}</td>
          </tr>
        );
      })}
    </>
  );
}

function FileView({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(true);
  const path = displayPath(file);

  return (
    <div className={styles.file}>
      <div
        className={styles.fileHeader}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span
          className={`${styles.collapseIndicator} ${open ? styles.collapseIndicatorOpen : ""}`}
        >
          ▶
        </span>
        <span className={styles.filePath}>{path}</span>
        <span className={`${styles.badge} ${statusStyles[file.status]}`}>
          {statusLabels[file.status]}
        </span>
      </div>

      {open && (
        <>
          {file.isBinary ? (
            <div className={styles.binaryNotice}>Binary file</div>
          ) : (
            file.hunks.length > 0 && (
              <table className={styles.hunkTable}>
                <tbody>
                  {file.hunks.map((hunk, i) => (
                    <HunkView
                      key={`${hunk.header}-${i}`}
                      hunk={hunk}
                      filePath={file.newPath}
                    />
                  ))}
                </tbody>
              </table>
            )
          )}
        </>
      )}
    </div>
  );
}

export default function DiffViewer({ files }: Props) {
  return (
    <div className={styles.container}>
      {files.map((file) => (
        <FileView key={`${file.oldPath}-${file.newPath}`} file={file} />
      ))}
    </div>
  );
}
