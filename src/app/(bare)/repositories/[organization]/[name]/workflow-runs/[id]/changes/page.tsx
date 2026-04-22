"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import DiffViewer from "@/app/components/DiffViewer/DiffViewer";
import { useWorkflowRun } from "@/lib/hooks/swr";
import {
  type DiffResponse,
  fetchWorkflowRunDiff,
  isNotFoundError,
} from "@/lib/utils/api";
import { type DiffFile, parseDiff } from "@/lib/utils/parseDiff";
import styles from "./DiffPage.module.css";

export default function ChangesPage() {
  const { id, organization, name } = useParams<{
    id: string;
    organization: string;
    name: string;
  }>();

  const {
    data: run,
    error: runError,
    isLoading: runLoading,
  } = useWorkflowRun(id);

  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);

    fetchWorkflowRunDiff(id)
      .then((data) => {
        if (!cancelled) {
          setDiffData(data);
          setFiles(parseDiff(data.diff));
          setDiffLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDiffError(
            err instanceof Error ? err.message : "Failed to load diff",
          );
          setDiffLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!run && runLoading) return null;
  if (isNotFoundError(runError)) return notFound();
  if (runError) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>
          {runError instanceof Error
            ? runError.message
            : "Failed to load workflow run"}
        </p>
      </main>
    );
  }
  if (!run) return null;

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Changes</h1>
        {diffData?.stat && <pre className={styles.stat}>{diffData.stat}</pre>}
      </div>

      {diffLoading && <p className={styles.loading}>Loading diff…</p>}
      {diffError && <p className={styles.error}>{diffError}</p>}
      {!diffLoading && !diffError && files.length === 0 && (
        <p className={styles.empty}>No changes</p>
      )}
      {files.length > 0 && <DiffViewer files={files} />}

      <div className={styles.footer}>
        <Link
          href={`/repositories/${organization}/${name}/workflow-runs/${id}`}
          className={styles.backLink}
        >
          Back to workflow run
        </Link>
      </div>
    </main>
  );
}
