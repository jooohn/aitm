"use client";

import { useState } from "react";
import type { DiffFileDto } from "@/shared/contracts/api";
import styles from "./DiffViewer.module.css";

const STATUS_LABELS: Record<DiffFileDto["status"], string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
};

interface Props {
  files: DiffFileDto[];
}

export default function DiffViewer({ files }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (files.length === 0) {
    return <p className={styles.empty}>No changes</p>;
  }

  function toggleFile(path: string) {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  return (
    <div className={styles.container}>
      {files.map((file) => {
        const isCollapsed = collapsed[file.path] ?? false;
        return (
          <div key={file.path} className={styles.file}>
            <div
              className={styles.fileHeader}
              onClick={() => toggleFile(file.path)}
            >
              <span
                className={`${styles.chevron} ${isCollapsed ? "" : styles.chevronExpanded}`}
              >
                &#9654;
              </span>
              <span
                className={`${styles.badge} ${styles[`badge-${file.status}`]}`}
              >
                {STATUS_LABELS[file.status]}
              </span>
              <span className={styles.filePath}>{file.path}</span>
              {file.old_path && (
                <span className={styles.fileOldPath}>
                  (renamed from {file.old_path})
                </span>
              )}
            </div>
            {!isCollapsed && (
              <table className={styles.diffTable}>
                <tbody>
                  {file.hunks.flatMap((hunk, hunkIdx) =>
                    hunk.lines.map((line, lineIdx) => (
                      <tr
                        key={`${hunkIdx}-${lineIdx}`}
                        className={styles[`line-${line.type}`]}
                      >
                        <td className={styles.lineNumber}>
                          {line.old_line ?? ""}
                        </td>
                        <td className={styles.lineNumber}>
                          {line.new_line ?? ""}
                        </td>
                        <td className={styles.lineContent}>{line.content}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
