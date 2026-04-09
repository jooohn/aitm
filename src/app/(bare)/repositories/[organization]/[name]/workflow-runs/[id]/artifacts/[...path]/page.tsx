"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowBreadcrumb from "@/app/(main)/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowBreadcrumb";
import { useWorkflowRun, useWorkflows } from "@/lib/hooks/swr";
import { isNotFoundError } from "@/lib/utils/api";
import styles from "./ArtifactPage.module.css";
import ArtifactViewer from "./ArtifactViewer";

export default function ArtifactPage() {
  const { id, path, organization, name } = useParams<{
    id: string;
    path: string[];
    organization: string;
    name: string;
  }>();
  const artifactPath = path.join("/");

  const {
    data: run,
    error: runError,
    isLoading: runLoading,
  } = useWorkflowRun(id);
  const { data: workflows } = useWorkflows();

  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    fetch(`/api/workflow-runs/${id}/artifacts/${artifactPath}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load artifact (${res.status})`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setContentLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setContentError(
            err instanceof Error ? err.message : "Failed to load artifact",
          );
          setContentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, artifactPath]);

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

  const workflowDef = workflows?.[run.workflow_name];
  const artifactMeta = workflowDef?.artifacts?.find(
    (a) => a.path === artifactPath,
  );

  return (
    <main className={styles.page}>
      <WorkflowBreadcrumb
        repository={{ organization, name }}
        branch={run.worktree_branch}
        workflowRun={{ id: run.id, name: run.workflow_name }}
      />

      <div className={styles.header}>
        <h1 className={styles.title}>{artifactMeta?.name ?? artifactPath}</h1>
        {artifactMeta?.description && (
          <p className={styles.description}>{artifactMeta.description}</p>
        )}
      </div>

      {contentLoading && <p className={styles.loading}>Loading artifact…</p>}
      {contentError && <p className={styles.error}>{contentError}</p>}
      {content !== null && (
        <div className={styles.viewerContainer}>
          <ArtifactViewer path={artifactPath} content={content} />
        </div>
      )}

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
