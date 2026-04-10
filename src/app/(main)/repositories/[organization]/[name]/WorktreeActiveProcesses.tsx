"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProcesses } from "@/lib/hooks/swr";
import type { Process } from "@/lib/utils/api";
import { branchToSlug } from "@/lib/utils/branch-slug";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./WorktreeActiveProcesses.module.css";

interface Props {
  organization: string;
  name: string;
  branch: string;
}

const statusDotClass: Record<Process["status"], string> = {
  running: styles.dotRunning,
  crashed: styles.dotCrashed,
  // Stopped processes are filtered out before render.
  stopped: "",
};

const statusLabel: Record<Process["status"], string> = {
  running: "Running",
  crashed: "Crashed",
  stopped: "Stopped",
};

export default function WorktreeActiveProcesses({
  organization,
  name,
  branch,
}: Props) {
  const { data: processes } = useProcesses(organization, name, branch);
  const pathname = usePathname();

  const active = (processes ?? [])
    .filter((p) => p.status === "running" || p.status === "crashed")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (active.length === 0) return null;

  const branchSlug = branchToSlug(branch);

  return (
    <>
      <ul className={styles.list}>
        {active.map((process) => {
          const href = `/repositories/${organization}/${name}/worktrees/${branchSlug}/processes/${process.id}`;
          const isActive = pathname === href;
          return (
            <li key={process.id}>
              <Link
                href={href}
                className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
              >
                <span
                  className={`${styles.dot} ${statusDotClass[process.status]}`}
                  role="img"
                  aria-label={statusLabel[process.status]}
                />
                <span className={styles.info}>
                  <span className={styles.prompt} aria-hidden="true">
                    $
                  </span>
                  <span className={styles.label}>{process.command_label}</span>
                </span>
                <span className={styles.time}>
                  {timeAgo(process.created_at)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className={styles.divider} />
    </>
  );
}
