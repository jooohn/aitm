import Link from "next/link";
import type { Session } from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./SessionBreadcrumb.module.css";

interface Props {
  session: Session;
}

export default function SessionBreadcrumb({ session }: Props) {
  const repoAlias = inferAlias(session.repository_path);
  const [organization, repoName] = repoAlias.split("/");
  const branch = session.worktree_branch;

  return (
    <nav className={styles.breadcrumb}>
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
      {session.workflow_name && session.workflow_run_id && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          <Link
            href={`/workflow-runs/${session.workflow_run_id}`}
            className={styles.breadcrumbLink}
          >
            {session.workflow_name}
          </Link>
        </>
      )}
      {session.state_name && (
        <>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{session.state_name}</span>
        </>
      )}
    </nav>
  );
}
