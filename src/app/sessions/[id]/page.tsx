"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchSession,
  fetchSessionMessages,
  type Session,
  type SessionMessage,
} from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./page.module.css";
import SessionDetail from "./SessionDetail";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [initialMessages, setInitialMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchSession(id), fetchSessionMessages(id)])
      .then(([s, msgs]) => {
        setSession(s);
        setInitialMessages(msgs);
      })
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return null;
  if (!session) return notFound();

  const repoAlias = inferAlias(session.repository_path);
  const [organization, repoName] = repoAlias.split("/");
  const branch = session.worktree_branch;

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
