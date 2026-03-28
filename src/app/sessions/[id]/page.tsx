import Link from "next/link";
import { notFound } from "next/navigation";
import { listRepositories } from "@/lib/repositories";
import { getSession, listMessages } from "@/lib/sessions";
import styles from "./page.module.css";
import SessionDetail from "./SessionDetail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();

  const repo = listRepositories().find((r) => r.id === session.repository_id);
  const repoAlias = repo?.alias ?? String(session.repository_id);
  const [organization, repoName] = repoAlias.split("/");
  const branch = session.worktree_branch;
  const initialMessages = listMessages(id);

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
      <SessionDetail session={session} initialMessages={initialMessages} />
    </main>
  );
}
