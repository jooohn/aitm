"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { mutate } from "swr";
import Button from "@/app/components/Button";
import IconButton from "@/app/components/IconButton";
import PlayIcon from "@/app/components/icons/PlayIcon";
import StopIcon from "@/app/components/icons/StopIcon";
import { swrKeys, useProcesses } from "@/lib/hooks/swr";
import {
  type Process,
  type RepositoryCommand,
  startProcess,
  stopProcess,
} from "@/lib/utils/api";
import { branchToSlug } from "@/lib/utils/branch-slug";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./WorktreeProcesses.module.css";

interface Props {
  organization: string;
  name: string;
  branch: string;
  commands: RepositoryCommand[];
}

const statusDotClass: Record<Process["status"], string> = {
  running: styles.dotRunning,
  stopped: styles.dotStopped,
  crashed: styles.dotCrashed,
};

const statusLabel: Record<Process["status"], string> = {
  running: "Running",
  stopped: "Stopped",
  crashed: "Crashed",
};

export default function WorktreeProcesses({
  organization,
  name,
  branch,
  commands,
}: Props) {
  const { data: processes } = useProcesses(organization, name, branch);
  const pathname = usePathname();
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (commands.length === 0) return null;

  const branchSlug = branchToSlug(branch);

  async function handleLaunch(commandId: string) {
    setError(null);
    setLaunchingId(commandId);
    try {
      await startProcess(organization, name, branch, commandId);
      await mutate(swrKeys.processes(organization, name, branch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch process");
    } finally {
      setLaunchingId(null);
    }
  }

  async function handleStop(processId: string) {
    setError(null);
    setStoppingIds((prev) => new Set(prev).add(processId));
    try {
      await stopProcess(organization, name, branch, processId);
      await mutate(swrKeys.processes(organization, name, branch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop process");
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(processId);
        return next;
      });
    }
  }

  const sortedProcesses = [...(processes ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Processes</h2>

      <div className={styles.launchers}>
        {commands.map((command) => (
          <Button
            key={command.id}
            onClick={() => handleLaunch(command.id)}
            disabled={launchingId === command.id}
          >
            <span className={styles.launchIcon}>
              <PlayIcon size={12} />
            </span>
            {command.label}
          </Button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {sortedProcesses.length === 0 ? (
        <p className={styles.empty}>No processes running.</p>
      ) : (
        <ul className={styles.list}>
          {sortedProcesses.map((process) => {
            const href = `/repositories/${organization}/${name}/worktrees/${branchSlug}/processes/${process.id}`;
            const isActive = pathname === href;
            const isRunning = process.status === "running";
            const isStopping = stoppingIds.has(process.id);
            return (
              <li key={process.id}>
                <div
                  className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
                >
                  <Link
                    href={href}
                    className={styles.info}
                    aria-label={`Open ${process.command_label} output`}
                  >
                    <span className={styles.primary}>
                      <span
                        className={`${styles.dot} ${statusDotClass[process.status]}`}
                        role="img"
                        aria-label={statusLabel[process.status]}
                      />
                      <span className={styles.label}>
                        {process.command_label}
                      </span>
                      {process.exit_code !== null && (
                        <span className={styles.exitCode}>
                          exit {process.exit_code}
                        </span>
                      )}
                    </span>
                    <span className={styles.command}>{process.command}</span>
                  </Link>
                  <span className={styles.meta}>
                    {timeAgo(process.created_at)}
                  </span>
                  {isRunning && (
                    <IconButton
                      size="sm"
                      variant="destructive"
                      onClick={() => handleStop(process.id)}
                      disabled={isStopping}
                      aria-label="Stop process"
                      title={isStopping ? "Stopping…" : "Stop process"}
                    >
                      <StopIcon />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
