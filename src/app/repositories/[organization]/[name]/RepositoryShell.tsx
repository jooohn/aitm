"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import GitHubIcon from "@/app/components/icons/GitHubIcon";
import { useNotificationStream } from "@/lib/hooks/useNotificationStream";
import { fetchRepository, type RepositoryDetail } from "@/lib/utils/api";
import styles from "./RepositoryShell.module.css";
import WorktreeRunsSection from "./WorktreeRunsSection";
import RunWorkflowModal from "./workflow-runs/RunWorkflowModal";

interface Props {
  organization: string;
  name: string;
  children: React.ReactNode;
}

export default function RepositoryShell({
  organization,
  name,
  children,
}: Props) {
  const alias = `${organization}/${name}`;
  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useNotificationStream(() => setRefreshKey((k) => k + 1));

  useEffect(() => {
    fetchRepository(organization, name)
      .then(setRepo)
      .catch(() => setRepo(null));
  }, [organization, name]);

  return (
    <div className={styles.shell}>
      <aside className={styles.leftPane}>
        <div className={styles.headingRow}>
          <h1 className={styles.heading}>
            <Link
              href={`/repositories/${organization}/${name}`}
              className={styles.headingLink}
            >
              {alias}
            </Link>
          </h1>
          {repo?.github_url && (
            <a
              href={repo.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.githubLink}
              aria-label="Open on GitHub"
            >
              <GitHubIcon />
            </a>
          )}
        </div>
        <section className={styles.paneSection}>
          <button
            type="button"
            className={styles.launchButton}
            onClick={() => setShowLaunchModal(true)}
          >
            Run Workflow
          </button>
        </section>
        {repo && (
          <WorktreeRunsSection
            organization={organization}
            name={name}
            repositoryPath={repo.path}
            refreshKey={refreshKey}
          />
        )}
      </aside>
      <div className={styles.content}>{children}</div>
      {showLaunchModal && (
        <RunWorkflowModal
          onClose={() => setShowLaunchModal(false)}
          fixedAlias={alias}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
