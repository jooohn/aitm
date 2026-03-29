import Link from "next/link";
import { notFound } from "next/navigation";
import SessionSection from "@/app/components/SessionSection";
import WorkflowSection from "@/app/components/WorkflowSection";
import { getRepositoryByAlias } from "@/lib/repositories";
import { listWorktrees } from "@/lib/worktrees";
import styles from "./page.module.css";

interface Props {
  params: Promise<{
    organization: string;
    name: string;
    "worktree-name": string[];
  }>;
}

export default async function WorktreePage({ params }: Props) {
  const {
    organization,
    name,
    "worktree-name": worktreeNameSegments,
  } = await params;
  const alias = `${organization}/${name}`;
  const repo = getRepositoryByAlias(alias);
  if (!repo) notFound();

  const branch = worktreeNameSegments.join("/");
  let worktree;
  try {
    const worktrees = listWorktrees(repo.path);
    worktree = worktrees.find((w) => w.branch === branch);
  } catch {
    notFound();
  }
  if (!worktree) notFound();

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/" className={styles.breadcrumbLink}>
          Repositories
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link
          href={`/repositories/${organization}/${name}`}
          className={styles.breadcrumbLink}
        >
          {alias}
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span>{branch}</span>
      </nav>
      <h1 className={styles.heading}>{branch || "(bare)"}</h1>
      <dl className={styles.details}>
        <div className={styles.row}>
          <dt className={styles.label}>Path</dt>
          <dd className={styles.value}>{worktree.path}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>HEAD</dt>
          <dd className={styles.value}>{worktree.head}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Main</dt>
          <dd className={styles.value}>{worktree.is_main ? "Yes" : "No"}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Bare</dt>
          <dd className={styles.value}>{worktree.is_bare ? "Yes" : "No"}</dd>
        </div>
      </dl>
      <WorkflowSection repositoryPath={repo.path} branch={branch} />
      <SessionSection repositoryPath={repo.path} branch={branch} />
    </main>
  );
}
