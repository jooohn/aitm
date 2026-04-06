"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createWorkflowRun,
  createWorktree,
  fetchRepositories,
  fetchRepository,
  fetchWorkflows,
  type Repository,
  type WorkflowDefinition,
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
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedAlias, setSelectedAlias] = useState(fixedAlias ?? "");
  const [branch, setBranch] = useState(fixedBranch ?? "");
  const [workflows, setWorkflows] = useState<
    Record<string, WorkflowDefinition>
  >({});
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [repoList, wfs] = await Promise.all([
          fixedAlias
            ? fetchRepository(
                ...(fixedAlias.split("/") as [string, string]),
              ).then((r) => [r])
            : fetchRepositories(),
          fetchWorkflows(),
        ]);
        setRepos(repoList);
        if (!fixedAlias && repoList.length > 0) {
          setSelectedAlias(repoList[0].alias);
        }
        setWorkflows(wfs);
        const names = Object.keys(wfs);
        if (names.length > 0) setSelectedWorkflow(names[0]);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load configuration",
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fixedAlias]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch.trim() || !selectedWorkflow || !selectedAlias) return;
    const repo = repos.find((r) => r.alias === selectedAlias);
    if (!repo) return;
    const [organization, name] = repo.alias.split("/");
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!fixedBranch) {
        await createWorktree(organization, name, { branch });
      }
      const run = await createWorkflowRun({
        repository_path: repo.path,
        worktree_branch: branch,
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

  const workflowNames = Object.keys(workflows);

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
          workflowNames.length > 0 && (
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
              submitDisabled={submitting || !branch.trim()}
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
                  {!fixedBranch && <span className={styles.required}>*</span>}
                </label>
                {fixedBranch ? (
                  <span className={styles.fixedValue}>{fixedBranch}</span>
                ) : (
                  <input
                    id="rwm-branch"
                    type="text"
                    className={styles.input}
                    placeholder="e.g. feature/my-change"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    disabled={submitting}
                    required
                  />
                )}
              </div>
            </WorkflowLaunchForm>
          )}

        {submitError && <p className={styles.error}>{submitError}</p>}
      </div>
    </div>
  );
}
