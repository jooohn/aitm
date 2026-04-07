"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRepositories, useWorkflows } from "@/lib/hooks/swr";
import {
  createWorkflowRun,
  createWorktree,
  fetchRepository,
  generateBranchName,
  type Repository,
} from "@/lib/utils/api";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import styles from "./RunWorkflowModal.module.css";
import WorkflowLaunchForm from "./WorkflowLaunchForm";

interface Props {
  onClose: () => void;
  fixedAlias?: string;
  fixedBranch?: string;
  onCreated?: () => void;
}

export default function RunWorkflowModal({
  onClose,
  fixedAlias,
  fixedBranch,
  onCreated,
}: Props) {
  const router = useRouter();
  const [selectedAlias, setSelectedAlias] = useState(fixedAlias ?? "");
  const [branch, setBranch] = useState(fixedBranch ?? "");
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // For fixed alias, fetch just that repo; otherwise fetch all
  const [fixedRepo, setFixedRepo] = useState<Repository | null>(null);
  const [fixedRepoLoading, setFixedRepoLoading] = useState(!!fixedAlias);
  const [fixedRepoError, setFixedRepoError] = useState<string | null>(null);
  const { data: allRepos } = useRepositories();
  const { data: workflows, isLoading: workflowsLoading } = useWorkflows();

  useEffect(() => {
    if (!fixedAlias) return;
    const [org, name] = fixedAlias.split("/") as [string, string];
    setFixedRepoLoading(true);
    fetchRepository(org, name)
      .then((r) => setFixedRepo(r))
      .catch((err) =>
        setFixedRepoError(
          err instanceof Error ? err.message : "Failed to load repository",
        ),
      )
      .finally(() => setFixedRepoLoading(false));
  }, [fixedAlias]);

  const repos: Repository[] = fixedAlias
    ? fixedRepo
      ? [fixedRepo]
      : []
    : (allRepos ?? []);
  const loading = fixedAlias
    ? fixedRepoLoading || workflowsLoading
    : !allRepos || workflowsLoading;
  const loadError = fixedRepoError;

  // Auto-select first repo and workflow when data loads
  useEffect(() => {
    if (!fixedAlias && repos.length > 0 && !selectedAlias) {
      setSelectedAlias(repos[0].alias);
    }
  }, [fixedAlias, repos, selectedAlias]);

  useEffect(() => {
    if (workflows && !selectedWorkflow) {
      const names = Object.keys(workflows);
      if (names.length > 0) setSelectedWorkflow(names[0]);
    }
  }, [workflows, selectedWorkflow]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!autoGenerate && !branch.trim()) return;
    if (!selectedWorkflow || !selectedAlias) return;
    const repo = repos.find((r) => r.alias === selectedAlias);
    if (!repo) return;
    const [organization, name] = repo.alias.split("/");
    setSubmitting(true);
    setSubmitError(null);
    try {
      let effectiveBranch = branch;
      if (autoGenerate) {
        const inputs =
          Object.keys(inputValues).length > 0 ? inputValues : undefined;
        const result = await generateBranchName(selectedWorkflow, inputs);
        effectiveBranch = result.branch;
      }
      if (!fixedBranch) {
        await createWorktree(organization, name, { branch: effectiveBranch });
      }
      const run = await createWorkflowRun({
        repository_path: repo.path,
        worktree_branch: effectiveBranch,
        workflow_name: selectedWorkflow,
        inputs: Object.keys(inputValues).length > 0 ? inputValues : undefined,
      });
      onCreated?.();
      onClose();
      router.push(workflowRunPath(run));
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Failed to create worktree or launch workflow",
      );
      setSubmitting(false);
    }
  }

  const workflowNames = workflows ? Object.keys(workflows) : [];

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Run Workflow</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && <p className={styles.status}>Loading…</p>}
        {loadError && <p className={styles.error}>{loadError}</p>}

        {!loading && !loadError && !fixedAlias && repos.length === 0 && (
          <p className={styles.status}>No repositories configured.</p>
        )}

        {!loading &&
          !loadError &&
          (fixedAlias || repos.length > 0) &&
          workflowNames.length === 0 && (
            <p className={styles.status}>No workflows configured.</p>
          )}

        {!loading &&
          !loadError &&
          (fixedAlias || repos.length > 0) &&
          workflowNames.length > 0 &&
          workflows && (
            <WorkflowLaunchForm
              workflowNames={workflowNames}
              workflows={workflows}
              selectedWorkflow={selectedWorkflow}
              onWorkflowChange={(wf) => {
                setSelectedWorkflow(wf);
                setInputValues({});
              }}
              inputValues={inputValues}
              onInputChange={(inputName, value) =>
                setInputValues((prev) => ({ ...prev, [inputName]: value }))
              }
              onSubmit={handleSubmit}
              disabled={submitting}
              submitDisabled={submitting || (!autoGenerate && !branch.trim())}
              isSubmitting={submitting}
              submitLabel="Create & launch"
              submittingLabel="Launching…"
              idPrefix="rwm"
            >
              <div className={styles.fieldGroup}>
                <label htmlFor="rwm-repo" className={styles.label}>
                  Repository
                  {!fixedAlias && <span className={styles.required}>*</span>}
                </label>
                {fixedAlias ? (
                  <span className={styles.fixedValue}>{fixedAlias}</span>
                ) : (
                  <select
                    id="rwm-repo"
                    className={styles.select}
                    value={selectedAlias}
                    onChange={(e) => setSelectedAlias(e.target.value)}
                    disabled={submitting}
                  >
                    {repos.map((repo) => (
                      <option key={repo.alias} value={repo.alias}>
                        {repo.alias}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="rwm-branch" className={styles.label}>
                  Branch name
                  {!fixedBranch && !autoGenerate && (
                    <span className={styles.required}>*</span>
                  )}
                </label>
                {fixedBranch ? (
                  <span className={styles.fixedValue}>{fixedBranch}</span>
                ) : (
                  <>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={autoGenerate}
                        onChange={(e) => {
                          setAutoGenerate(e.target.checked);
                          if (e.target.checked) setBranch("");
                        }}
                        disabled={submitting}
                      />
                      <span className={styles.checkboxLabel}>
                        Auto-generate
                      </span>
                    </label>
                    <input
                      id="rwm-branch"
                      type="text"
                      className={styles.input}
                      placeholder={
                        autoGenerate
                          ? "Will be generated automatically"
                          : "e.g. feature/my-change"
                      }
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      disabled={submitting || autoGenerate}
                      required={!autoGenerate}
                    />
                  </>
                )}
              </div>
            </WorkflowLaunchForm>
          )}

        {submitError && <p className={styles.error}>{submitError}</p>}
      </div>
    </div>
  );
}
