"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { mutate } from "swr";
import StopIcon from "@/app/components/icons/StopIcon";
import { swrKeys, useProcesses } from "@/lib/hooks/swr";
import { type Process, stopProcess } from "@/lib/utils/api";
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
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

  const active = (processes ?? [])
    .filter((p) => p.status === "running" || p.status === "crashed")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Deduplicate: keep only the latest process per command_id
  const seen = new Set<string>();
  const latestPerCommand = active.filter((p) => {
    if (seen.has(p.command_id)) return false;
    seen.add(p.command_id);
    return true;
  });

  if (latestPerCommand.length === 0) return null;

  const branchSlug = branchToSlug(branch);

  async function handleStop(processId: string) {
    setStoppingIds((prev) => new Set(prev).add(processId));
    try {
      await stopProcess(organization, name, branch, processId);
      await mutate(swrKeys.processes(organization, name, branch));
    } catch (err) {
      console.error("Failed to stop process:", err);
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(processId);
        return next;
      });
    }
  }

  return (
    <>
      <ul className={styles.list}>
        {latestPerCommand.map((process) => {
          const href = `/repositories/${organization}/${name}/worktrees/${branchSlug}/processes/${process.id}`;
          const isActive = pathname === href;
          const isRunning = process.status === "running";
          const isStopping = stoppingIds.has(process.id);
          return (
            <li key={process.id}>
              <div
                className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
              >
                <Link href={href} className={styles.link}>
                  <span
                    className={`${styles.dot} ${statusDotClass[process.status]}`}
                    role="img"
                    aria-label={statusLabel[process.status]}
                  />
                  <span className={styles.info}>
                    <span className={styles.prompt} aria-hidden="true">
                      $
                    </span>
                    <span className={styles.label}>
                      {process.command_label}
                    </span>
                  </span>
                  <span className={styles.time}>
                    {timeAgo(process.created_at)}
                  </span>
                </Link>
                {isRunning && (
                  <button
                    type="button"
                    className={styles.stopButton}
                    onClick={() => handleStop(process.id)}
                    disabled={isStopping}
                    aria-label="Stop process"
                    title={isStopping ? "Stopping\u2026" : "Stop process"}
                  >
                    <StopIcon size={12} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.divider} />
    </>
  );
}
