"use client";

import { notFound, useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import IconButton from "@/app/components/IconButton";
import CloseIcon from "@/app/components/icons/CloseIcon";
import StopIcon from "@/app/components/icons/StopIcon";
import { swrKeys, useProcess } from "@/lib/hooks/swr";
import {
  isNotFoundError,
  type Process,
  processOutputStreamUrl,
  stopProcess,
} from "@/lib/utils/api";
import { slugToBranch } from "@/lib/utils/branch-slug";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./ProcessDrawer.module.css";

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

export default function ProcessDrawer() {
  const {
    organization,
    name,
    branch: branchSlug,
    processId,
  } = useParams<{
    organization: string;
    name: string;
    branch: string;
    processId: string;
  }>();
  const pathname = usePathname();
  const branch = slugToBranch(branchSlug);

  const {
    data: process,
    error,
    isLoading,
  } = useProcess(organization, name, branch, processId);

  const [output, setOutput] = useState<string[]>([]);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const shouldShow = /\/processes\/[^/]+$/.test(pathname);

  useEffect(() => {
    if (shouldShow) {
      setClosed(false);
      setClosing(false);
    }
  }, [shouldShow]);

  // Stream output via SSE.
  useEffect(() => {
    if (!organization || !name || !branch || !processId) return;
    setOutput([]);
    stickToBottomRef.current = true;
    const url = processOutputStreamUrl(organization, name, branch, processId);
    const source = new EventSource(url);
    source.onmessage = (event) => {
      setOutput((prev) => [...prev, event.data]);
    };
    source.addEventListener("done", () => {
      source.close();
      void mutate(swrKeys.process(organization, name, branch, processId));
    });
    source.onerror = () => {
      source.close();
    };
    return () => source.close();
  }, [organization, name, branch, processId]);

  // Auto-scroll to bottom when new output arrives, unless the user scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately react to output changes
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [output]);

  function handleTerminalScroll() {
    const el = terminalRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 8;
  }

  const handleClose = useCallback(() => {
    setClosing(true);
    const parentPath = pathname.replace(/\/processes\/[^/]+$/, "");
    setTimeout(() => {
      setClosed(true);
      window.history.replaceState(null, "", parentPath);
    }, 200);
  }, [pathname]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  async function handleStop() {
    if (!process) return;
    setStopping(true);
    setStopError(null);
    try {
      await stopProcess(organization, name, branch, process.id);
      await mutate(swrKeys.process(organization, name, branch, process.id));
      await mutate(swrKeys.processes(organization, name, branch));
    } catch (err) {
      setStopError(
        err instanceof Error ? err.message : "Failed to stop process",
      );
    } finally {
      setStopping(false);
    }
  }

  if (closed) return null;
  if (!process && isLoading) return null;
  if (isNotFoundError(error)) return notFound();
  if (error) {
    return (
      <div className={styles.overlay}>
        <div className={styles.backdrop} onClick={handleClose} />
        <aside className={styles.drawer}>
          <div className={styles.drawerHeader}>
            <h2 className={styles.title}>Process unavailable</h2>
            <div className={styles.headerActions}>
              <IconButton
                size="sm"
                onClick={handleClose}
                aria-label="Close process drawer"
              >
                <CloseIcon />
              </IconButton>
            </div>
          </div>
          <p className={styles.error}>
            {error instanceof Error ? error.message : "Failed to load process"}
          </p>
        </aside>
      </div>
    );
  }
  if (!process) return null;

  const isRunning = process.status === "running";

  return (
    <div className={styles.overlay}>
      <div
        className={`${styles.backdrop} ${closing ? styles.backdropClosing : ""}`}
        onClick={handleClose}
      />
      <aside
        className={`${styles.drawer} ${closing ? styles.drawerClosing : ""}`}
      >
        <div className={styles.drawerHeader}>
          <h2 className={styles.title}>
            <span
              className={`${styles.dot} ${statusDotClass[process.status]}`}
              role="img"
              aria-label={statusLabel[process.status]}
            />
            <span>{process.command_label}</span>
          </h2>
          <div className={styles.headerActions}>
            {isRunning && (
              <IconButton
                size="sm"
                variant="destructive"
                onClick={handleStop}
                disabled={stopping}
                aria-label="Stop process"
                title={stopping ? "Stopping…" : "Stop process"}
              >
                <StopIcon />
              </IconButton>
            )}
            <IconButton
              size="sm"
              onClick={handleClose}
              aria-label="Close process drawer"
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>

        <div className={styles.meta}>
          <div className={styles.metaCommand}>{process.command}</div>
          <div className={styles.metaRow}>
            <span>
              <span className={styles.metaLabel}>Status: </span>
              {statusLabel[process.status]}
            </span>
            {process.pid !== null && (
              <span>
                <span className={styles.metaLabel}>PID: </span>
                {process.pid}
              </span>
            )}
            {process.exit_code !== null && (
              <span>
                <span className={styles.metaLabel}>Exit: </span>
                {process.exit_code}
              </span>
            )}
            <span>
              <span className={styles.metaLabel}>Started: </span>
              {timeAgo(process.created_at)}
            </span>
            {process.stopped_at && (
              <span>
                <span className={styles.metaLabel}>Stopped: </span>
                {timeAgo(process.stopped_at)}
              </span>
            )}
          </div>
          {stopError && <p className={styles.error}>{stopError}</p>}
        </div>

        <div
          ref={terminalRef}
          onScroll={handleTerminalScroll}
          className={styles.terminal}
        >
          {output.length === 0 ? (
            <span className={styles.terminalEmpty}>No output yet.</span>
          ) : (
            output.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      </aside>
    </div>
  );
}
