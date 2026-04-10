"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { mutate } from "swr";
import PlayIcon from "@/app/components/icons/PlayIcon";
import { swrKeys, useProcesses } from "@/lib/hooks/swr";
import {
  createWorkflowRun,
  type RepositoryCommand,
  startProcess,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRunDetail,
} from "@/lib/utils/api";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import {
  allRequiredInputsProvided,
  type ResolvedWorkflowSuggestion,
  resolveWorkflowSuggestions,
} from "@/lib/utils/workflowSuggestions";
import styles from "./WorktreePlayMenu.module.css";

interface Props {
  organization: string;
  name: string;
  branch: string;
  runs: WorkflowRun[];
  commands: RepositoryCommand[];
  workflows: Record<string, WorkflowDefinition> | undefined;
}

export default function WorktreePlayMenu({
  organization,
  name,
  branch,
  runs,
  commands,
  workflows,
}: Props) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: processes } = useProcesses(organization, name, branch);

  const activeCommandIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of processes ?? []) {
      if (p.status === "running") ids.add(p.command_id);
    }
    return ids;
  }, [processes]);

  const suggestions = useMemo<ResolvedWorkflowSuggestion[]>(() => {
    if (!workflows) return [];
    const seen = new Set<string>();
    const result: ResolvedWorkflowSuggestion[] = [];
    for (const run of runs) {
      // resolveWorkflowSuggestions expects a WorkflowRunDetail; conditions
      // typically only reference base run fields (metadata, inputs, status),
      // so we pass an empty step_executions array as an acceptable fallback.
      const runDetail: WorkflowRunDetail = { ...run, step_executions: [] };
      for (const suggestion of resolveWorkflowSuggestions(
        runDetail,
        workflows,
      )) {
        const def = workflows[suggestion.workflow];
        if (!def) continue;
        if (!allRequiredInputsProvided(def, suggestion.inputValues)) continue;
        if (seen.has(suggestion.workflow)) continue;
        seen.add(suggestion.workflow);
        result.push(suggestion);
      }
    }
    return result;
  }, [runs, workflows]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleStartCommand(commandId: string) {
    setBusy(true);
    setError(null);
    try {
      await startProcess(organization, name, branch, commandId);
      await mutate(swrKeys.processes(organization, name, branch));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start command");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartWorkflow(suggestion: ResolvedWorkflowSuggestion) {
    setBusy(true);
    setError(null);
    try {
      const run = await createWorkflowRun({
        organization,
        name,
        worktree_branch: branch,
        workflow_name: suggestion.workflow,
        inputs:
          Object.keys(suggestion.inputValues).length > 0
            ? suggestion.inputValues
            : undefined,
      });
      await mutate(swrKeys.workflowRuns({ organization, name }));
      setOpen(false);
      router.push(workflowRunPath(run));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start workflow");
    } finally {
      setBusy(false);
    }
  }

  const hasCommands = commands.length > 0;
  const hasSuggestions = suggestions.length > 0;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-label="Run command or workflow"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Run command or workflow"
        disabled={busy}
      >
        <PlayIcon size={14} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.groupHeading}>Commands</div>
          {hasCommands ? (
            commands.map((command) => {
              const running = activeCommandIds.has(command.id);
              return (
                <button
                  key={command.id}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  disabled={running || busy}
                  title={running ? "Already running" : undefined}
                  onClick={() => handleStartCommand(command.id)}
                >
                  {command.label}
                </button>
              );
            })
          ) : (
            <p className={styles.empty}>No commands configured.</p>
          )}
          <div className={styles.separator} />
          <div className={styles.groupHeading}>Workflows</div>
          {hasSuggestions ? (
            suggestions.map((suggestion) => (
              <button
                key={suggestion.workflow}
                type="button"
                role="menuitem"
                className={styles.item}
                disabled={busy}
                onClick={() => handleStartWorkflow(suggestion)}
              >
                {suggestion.label}
              </button>
            ))
          ) : (
            <p className={styles.empty}>No suggested workflows.</p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </div>
  );
}
