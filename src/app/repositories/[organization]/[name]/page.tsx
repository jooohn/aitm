import Link from "next/link";
import { notFound } from "next/navigation";
import QuickLaunchSection from "@/app/components/QuickLaunchSection";
import RepositoryWorkflowsSection from "@/app/components/RepositoryWorkflowsSection";
import WorktreeSection from "@/app/components/WorktreeSection";
import { getRepositoryByAlias } from "@/lib/domain/repositories";
import { listWorktrees } from "@/lib/domain/worktrees";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ organization: string; name: string }>;
}

export default async function RepositoryPage({ params }: Props) {
  const { organization, name } = await params;
  const alias = `${organization}/${name}`;
  const repo = getRepositoryByAlias(alias);

  if (!repo) notFound();

  let activeWorktreeBranches: string[] | null = null;
  try {
    const worktrees = listWorktrees(repo.path);
    activeWorktreeBranches = worktrees.map((w) => w.branch).filter(Boolean);
  } catch {
    // fallback: show all workflow runs
  }

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/" className={styles.breadcrumbLink}>
          Repositories
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span>{alias}</span>
      </nav>
      <h1 className={styles.heading}>{alias}</h1>
      <dl className={styles.details}>
        <div className={styles.row}>
          <dt className={styles.label}>Path</dt>
          <dd className={styles.value}>{repo.path}</dd>
        </div>
      </dl>
      <RepositoryWorkflowsSection
        repositoryPath={repo.path}
        activeWorktreeBranches={activeWorktreeBranches}
      />
      <QuickLaunchSection
        organization={organization}
        name={name}
        repositoryPath={repo.path}
      />
      <WorktreeSection organization={organization} name={name} />
    </main>
  );
}
