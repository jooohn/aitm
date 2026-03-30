import Link from "next/link";
import { notFound } from "next/navigation";
import { inferAlias } from "@/lib/domain/repositories";
import { getWorkflowRun } from "@/lib/domain/workflow-runs";
import styles from "./page.module.css";
import WorkflowRunDetail from "./WorkflowRunDetail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorkflowRunPage({ params }: Props) {
  const { id } = await params;
  const run = getWorkflowRun(id);
  if (!run) notFound();

  const repoAlias = inferAlias(run.repository_path);
  const [organization, repoName] = repoAlias.split("/");
  const branch = run.worktree_branch;

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/" className={styles.breadcrumbLink}>
          Repositories
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        {organization && repoName ? (
          <>
            <Link
              href={`/repositories/${organization}/${repoName}`}
              className={styles.breadcrumbLink}
            >
              {repoAlias}
            </Link>
            <span className={styles.breadcrumbSep}>/</span>
            <Link
              href={`/repositories/${organization}/${repoName}/worktrees/${branch}`}
              className={styles.breadcrumbLink}
            >
              {branch}
            </Link>
          </>
        ) : (
          <span>{repoAlias}</span>
        )}
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{id.slice(0, 8)}…</span>
      </nav>
      <WorkflowRunDetail run={run} />
    </main>
  );
}
