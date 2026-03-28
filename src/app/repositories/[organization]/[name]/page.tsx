import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepositoryByAlias } from "@/lib/repositories";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ organization: string; name: string }>;
}

export default async function RepositoryPage({ params }: Props) {
  const { organization, name } = await params;
  const alias = `${organization}/${name}`;
  const repo = getRepositoryByAlias(alias);

  if (!repo) notFound();

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
        <div className={styles.row}>
          <dt className={styles.label}>Registered</dt>
          <dd className={styles.value}>
            {new Date(repo.created_at).toLocaleString()}
          </dd>
        </div>
      </dl>
    </main>
  );
}
