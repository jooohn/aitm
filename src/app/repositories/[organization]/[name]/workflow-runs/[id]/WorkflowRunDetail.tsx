"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import EllipsisIcon from "@/app/components/icons/EllipsisIcon";
import ExternalLinkIcon from "@/app/components/icons/ExternalLinkIcon";
import StatusBadge from "@/app/components/StatusBadge";
import { swrKeys, useWorkflowRun, useWorkflows } from "@/lib/hooks/swr";
import {
  canStopWorkflowRun,
  createWorkflowRun,
  rerunWorkflowRun,
  rerunWorkflowRunFromFailedState,
  resolveManualApproval,
  stopWorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { extractPullRequestUrl } from "@/lib/utils/extractPullRequestUrl";
import { inferAlias } from "@/lib/utils/inferAlias";
import { timeAgo } from "@/lib/utils/timeAgo";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import {
  allRequiredInputsProvided,
  resolveWorkflowSuggestions,
} from "@/lib/utils/workflowSuggestions";
import RunWorkflowModal from "../RunWorkflowModal";
import { parseWorkflowRunInputs } from "./parseWorkflowRunInputs";
import StepExecutionItem from "./StepExecutionItem";
import styles from "./WorkflowRunDetail.module.css";
import WorkflowStepDiagram from "./WorkflowStepDiagram";

interface Props {
  run: WorkflowRunDetail;
  basePath?: string;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  awaiting: "Awaiting",
  success: "Success",
  failure: "Failure",
};

export default function WorkflowRunDetailView({
  run: initial,
  basePath,
}: Props) {
  const router = useRouter();
  const { data: run } = useWorkflowRun(initial.id, {
    fallbackData: initial,
  });
  const { data: workflows } = useWorkflows();

  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [rerunningFromFailed, setRerunningFromFailed] = useState(false);
  const [rerunFromFailedError, setRerunFromFailedError] = useState<
    string | null
  >(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Action menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Launch workflow modal state
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchPreset, setLaunchPreset] = useState<{
    workflow: string;
    inputValues: Record<string, string>;
  } | null>(null);

  // Direct suggestion launch state
  const [submittingSuggestion, setSubmittingSuggestion] = useState<
    string | null
  >(null);

  // Use the SWR data (falls back to initial via fallbackData)
  const currentRun = run ?? initial;
  const workflowDefinition = workflows?.[currentRun.workflow_name] ?? null;
  const workflowLabel = workflowDefinition?.label ?? currentRun.workflow_name;
  const workflowArtifacts = workflowDefinition?.artifacts ?? [];
  const suggestedWorkflows = resolveWorkflowSuggestions(currentRun, workflows);

  const inputEntries = parseWorkflowRunInputs(currentRun.inputs);
  const inputLabelMap = new Map(
    workflowDefinition?.inputs?.map((i) => [i.name, i.label]),
  );
  const canStop = canStopWorkflowRun(currentRun);
  const pullRequestUrl = extractPullRequestUrl(currentRun.metadata);

  const handleStepClick = useCallback(
    (stepId: string) => {
      // Find the latest execution for this step
      const latest = [...currentRun.step_executions]
        .reverse()
        .find((e) => e.step === stepId);
      if (!latest) return;
      const el = document.getElementById(`step-execution-${latest.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(styles.highlight);
        setTimeout(() => el.classList.remove(styles.highlight), 1500);
      }
    },
    [currentRun.step_executions],
  );

  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const newRun = await rerunWorkflowRun(currentRun.id);
      router.push(workflowRunPath(newRun));
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : "Re-run failed");
    } finally {
      setRerunning(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    setStopError(null);
    try {
      const updated = await stopWorkflowRun(currentRun.id);
      await mutate(swrKeys.workflowRun(currentRun.id), updated);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  async function handleResolve(
    executionId: string,
    decision: "approved" | "rejected",
    reason: string,
  ) {
    setResolvingId(executionId);
    try {
      const updated = await resolveManualApproval(
        currentRun.id,
        decision,
        reason || undefined,
      );
      await mutate(swrKeys.workflowRun(currentRun.id), updated);
    } catch {
      // ignore resolve errors — the poll will pick up the state
    } finally {
      setResolvingId(null);
    }
  }

  async function handleRerunFromFailed() {
    setRerunningFromFailed(true);
    setRerunFromFailedError(null);
    try {
      const updated = await rerunWorkflowRunFromFailedState(currentRun.id);
      await mutate(swrKeys.workflowRun(currentRun.id), updated);
    } catch (err) {
      setRerunFromFailedError(
        err instanceof Error ? err.message : "Re-run from failed state failed",
      );
    } finally {
      setRerunningFromFailed(false);
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function openLaunchModal() {
    setMenuOpen(false);
    setLaunchPreset(null);
    setShowLaunchModal(true);
  }

  function openSuggestedWorkflow(
    workflow: string,
    inputValues: Record<string, string>,
  ) {
    setMenuOpen(false);
    setLaunchPreset({ workflow, inputValues });
    setShowLaunchModal(true);
  }

  async function handleSuggestionClick(suggestion: {
    workflow: string;
    inputValues: Record<string, string>;
  }) {
    const targetWorkflow = workflows?.[suggestion.workflow];
    if (
      targetWorkflow &&
      allRequiredInputsProvided(targetWorkflow, suggestion.inputValues)
    ) {
      setSubmittingSuggestion(suggestion.workflow);
      try {
        const newRun = await createWorkflowRun({
          repository_path: currentRun.repository_path,
          worktree_branch: currentRun.worktree_branch,
          workflow_name: suggestion.workflow,
          inputs: suggestion.inputValues,
        });
        router.push(workflowRunPath(newRun));
      } catch {
        // Fall back to modal on error
        openSuggestedWorkflow(suggestion.workflow, suggestion.inputValues);
      } finally {
        setSubmittingSuggestion(null);
      }
    } else {
      openSuggestedWorkflow(suggestion.workflow, suggestion.inputValues);
    }
  }

  function handleMenuRerun() {
    setMenuOpen(false);
    handleRerun();
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>
            <Link
              href={`/repositories/${inferAlias(currentRun.repository_path)}/worktrees/${currentRun.worktree_branch}`}
              className={styles.titleBranchLink}
            >
              {currentRun.worktree_branch}
            </Link>
            <span className={styles.titleSeparator}>/</span>
            {workflowLabel}
            <span className={styles.titleRunId}>({currentRun.id})</span>
          </h1>
          <div className={styles.headerMeta}>
            <StatusBadge variant={currentRun.status}>
              {STATUS_LABELS[currentRun.status]}
            </StatusBadge>
            <p className={styles.headerTimestamps}>
              Created {timeAgo(currentRun.created_at)}, Last modified{" "}
              {timeAgo(currentRun.updated_at)}
            </p>
          </div>
        </div>
        <div className={styles.headerRight}>
          {canStop && (
            <div className={styles.stopActions}>
              <button
                className={styles.stopButton}
                onClick={handleStop}
                disabled={stopping}
              >
                {stopping ? "Stopping…" : "Stop Immediately"}
              </button>
              {stopError && <p className={styles.rerunError}>{stopError}</p>}
            </div>
          )}
          {currentRun.status === "failure" && (
            <div className={styles.headerActions}>
              <button
                className={styles.rerunButton}
                onClick={handleRerunFromFailed}
                disabled={rerunningFromFailed}
              >
                {rerunningFromFailed
                  ? "Re-running…"
                  : "Re-run from failed step"}
              </button>
              {rerunFromFailedError && (
                <p className={styles.rerunError}>{rerunFromFailedError}</p>
              )}
            </div>
          )}
          <div className={styles.menuWrapper} ref={menuRef}>
            <button
              type="button"
              className={styles.menuButton}
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Actions"
            >
              <EllipsisIcon />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleMenuRerun}
                  disabled={rerunning}
                >
                  {rerunning ? "Re-running…" : "Re-run"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={openLaunchModal}
                >
                  Run another workflow
                </button>
              </div>
            )}
          </div>
          {rerunError && <p className={styles.rerunError}>{rerunError}</p>}
        </div>
      </div>

      {pullRequestUrl && (
        <a
          href={pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.prBanner}
        >
          <span className={styles.prBannerText}>
            Pull request created:{" "}
            <span className={styles.prBannerUrl}>
              {pullRequestUrl.match(/\/pull\/(\d+)/)
                ? `${pullRequestUrl.match(/github\.com\/([^/]+\/[^/]+)/)?.[1]}#${pullRequestUrl.match(/\/pull\/(\d+)/)?.[1]}`
                : pullRequestUrl}
            </span>
            <ExternalLinkIcon size={14} className={styles.prBannerIcon} />
          </span>
        </a>
      )}

      {suggestedWorkflows.length > 0 && (
        <section>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionHeading}>Suggested Next Workflows</h2>
          </div>
          <div className={styles.suggestionList}>
            {suggestedWorkflows.map((suggestion) => (
              <button
                key={suggestion.workflow}
                type="button"
                className={styles.suggestionButton}
                disabled={submittingSuggestion === suggestion.workflow}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {submittingSuggestion === suggestion.workflow
                  ? "Starting…"
                  : `Start ${suggestion.label}`}
              </button>
            ))}
          </div>
        </section>
      )}

      {inputEntries.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading}>Inputs</h2>
          <dl className={styles.details}>
            {inputEntries.map((entry) => (
              <div key={entry.key} className={styles.detailRow}>
                <dt className={styles.detailLabel}>
                  {inputLabelMap.get(entry.key) ?? entry.key}
                </dt>
                <dd className={styles.detailValue}>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {workflowArtifacts.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading}>Artifacts</h2>
          <ul className={styles.artifactList}>
            {workflowArtifacts.map((artifact) => (
              <li key={artifact.path} className={styles.artifactItem}>
                <a
                  href={`/api/workflow-runs/${currentRun.id}/artifacts/${artifact.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.artifactLink}
                >
                  <span>{artifact.name}</span>
                  <ExternalLinkIcon
                    size={14}
                    className={styles.artifactLinkIcon}
                  />
                </a>
                {artifact.description && (
                  <p className={styles.artifactDescription}>
                    {artifact.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {workflowDefinition && (
        <section>
          <h2 className={styles.sectionHeading}>Step diagram</h2>
          <WorkflowStepDiagram
            definition={workflowDefinition}
            stepExecutions={currentRun.step_executions}
            currentStep={currentRun.current_step}
            status={currentRun.status}
            onStepClick={handleStepClick}
          />
        </section>
      )}

      <section>
        <h2 className={styles.sectionHeading}>Step executions</h2>
        {currentRun.step_executions.length === 0 ? (
          <p className={styles.empty}>No step executions yet.</p>
        ) : (
          <ul className={styles.executions}>
            {[...currentRun.step_executions]
              .reverse()
              .map((execution, index) => (
                <StepExecutionItem
                  key={execution.id}
                  execution={execution}
                  isCurrent={index === 0}
                  runBasePath={
                    basePath ??
                    `/repositories/${inferAlias(currentRun.repository_path)}/workflow-runs/${currentRun.id}`
                  }
                  onResolve={handleResolve}
                  resolvingId={resolvingId}
                />
              ))}
          </ul>
        )}
      </section>

      {showLaunchModal && (
        <RunWorkflowModal
          onClose={() => setShowLaunchModal(false)}
          fixedAlias={inferAlias(currentRun.repository_path)}
          fixedBranch={currentRun.worktree_branch}
          initialWorkflow={launchPreset?.workflow}
          initialInputValues={launchPreset?.inputValues}
        />
      )}
    </div>
  );
}
