"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRepositories } from "@/lib/hooks/swr";
import {
  createWorkflowRun,
  createWorktree,
  fetchRemoteBranches,
  fetchRepository,
  fetchWorktrees,
  generateBranchName,
  type RemoteBranch,
  type Repository,
  type RepositoryDetail,
  type WorkflowDefinition,
  type Worktree,
} from "@/lib/utils/api";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import styles from "./RunWorkflowModal.module.css";
import WorkflowLaunchForm from "./WorkflowLaunchForm";

interface Props {
  onClose: () => void;
  fixedAlias?: string;
  fixedBranch?: string;
  initialWorkflow?: string;
  initialInputValues?: Record<string, string>;
  onCreated?: () => void;
}

export default function RunWorkflowModal({
  onClose,
  fixedAlias,
  fixedBranch,
  initialWorkflow,
  initialInputValues = {},
  onCreated,
}: Props) {
  const router = useRouter();
  const [selectedAlias, setSelectedAlias] = useState(fixedAlias ?? "");
  const [branch, setBranch] = useState(fixedBranch ?? "");
  const [selectedWorkflow, setSelectedWorkflow] = useState(
    initialWorkflow ?? "",
  );
  const [inputValues, setInputValues] =
    useState<Record<string, string>>(initialInputValues);
  const [autoGenerate, setAutoGenerate] = useState(!fixedBranch);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Import remote branch mode
  const [importMode, setImportMode] = useState(false);
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranch[] | null>(
    null,
  );
  const [remoteBranchesLoading, setRemoteBranchesLoading] = useState(false);
  const [localWorktrees, setLocalWorktrees] = useState<Worktree[] | null>(null);

  // Fetch repository detail (includes per-repo workflows)
  const [repoDetail, setRepoDetail] = useState<RepositoryDetail | null>(null);
  const [repoDetailLoading, setRepoDetailLoading] = useState(!!fixedAlias);
  const [repoDetailError, setRepoDetailError] = useState<string | null>(null);
  const { data: allRepos } = useRepositories();

  // Fetch repo detail when alias is known (either fixed or selected)
  const effectiveAlias = fixedAlias ?? selectedAlias;
  useEffect(() => {
    if (!effectiveAlias) return;
    const [org, repoName] = effectiveAlias.split("/") as [string, string];
    setRepoDetailLoading(true);
    setRepoDetailError(null);
    fetchRepository(org, repoName)
      .then((r) => setRepoDetail(r))
      .catch((err) =>
        setRepoDetailError(
          err instanceof Error ? err.message : "Failed to load repository",
        ),
      )
      .finally(() => setRepoDetailLoading(false));
  }, [effectiveAlias]);

  const workflows: Record<string, WorkflowDefinition> | undefined =
    repoDetail?.workflows;

  const repos: Repository[] = fixedAlias
    ? repoDetail
      ? [repoDetail]
      : []
    : (allRepos ?? []);
  const loading = fixedAlias
    ? repoDetailLoading
    : !allRepos || (!!selectedAlias && repoDetailLoading);
  const loadError = repoDetailError;

  // Auto-select first repo and workflow when data loads
  useEffect(() => {
    if (!fixedAlias && repos.length > 0 && !selectedAlias) {
      setSelectedAlias(repos[0].alias);
    }
  }, [fixedAlias, repos, selectedAlias]);

  // Reset selected workflow when workflows change (e.g. repo switch)
  useEffect(() => {
    if (!workflows) return;
    const allNames = Object.keys(workflows).filter(
      (name) => !fixedBranch || workflows[name]?.runs_on !== "main",
    );
    // Keep current selection if it's still valid
    if (selectedWorkflow && allNames.includes(selectedWorkflow)) return;
    const names =
      initialWorkflow && allNames.includes(initialWorkflow)
        ? [initialWorkflow, ...allNames.filter((wf) => wf !== initialWorkflow)]
        : allNames;
    setSelectedWorkflow(names.length > 0 ? names[0] : "");
  }, [initialWorkflow, workflows, fixedBranch]); // intentionally exclude selectedWorkflow

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function enterImportMode() {
    setImportMode(true);
    setAutoGenerate(false);
    setBranch("");

    const alias = selectedAlias || fixedAlias;
    if (!alias) return;

    const [org, name] = alias.split("/") as [string, string];
    setRemoteBranchesLoading(true);

    Promise.all([fetchRemoteBranches(org, name), fetchWorktrees(org, name)])
      .then(([branches, worktrees]) => {
        setRemoteBranches(branches);
        setLocalWorktrees(worktrees);
        if (branches.length > 0) {
          const localBranchNames = new Set(worktrees.map((w) => w.branch));
          const available = branches.filter(
            (b) => !localBranchNames.has(b.branch),
          );
          if (available.length > 0) {
            setBranch(available[0].branch);
          }
        }
      })
      .catch((err) => {
        setSubmitError(
          err instanceof Error ? err.message : "Failed to load remote branches",
        );
        exitImportMode();
      })
      .finally(() => setRemoteBranchesLoading(false));
  }

  function exitImportMode() {
    setImportMode(false);
    setAutoGenerate(true);
    setBranch("");
    setRemoteBranches(null);
    setLocalWorktrees(null);
  }

  const availableRemoteBranches =
    remoteBranches && localWorktrees
      ? remoteBranches.filter(
          (b) => !localWorktrees.some((w) => w.branch === b.branch),
        )
      : [];

  const workflowNames = workflows
    ? Object.keys(workflows).filter(
        (name) => !fixedBranch || workflows[name]?.runs_on !== "main",
      )
    : [];
  const runsOnMain =
    workflows && selectedWorkflow
      ? workflows[selectedWorkflow]?.runs_on === "main"
      : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!runsOnMain && !importMode && !autoGenerate && !branch.trim()) return;
    if (!runsOnMain && importMode && !branch) return;
    if (!selectedWorkflow || !selectedAlias) return;
    const repo = repos.find((r) => r.alias === selectedAlias);
    if (!repo) return;
    const [organization, name] = repo.alias.split("/");
    setSubmitting(true);
    setSubmitError(null);
    try {
      let effectiveBranch: string;
      if (runsOnMain) {
        const worktrees = await fetchWorktrees(organization, name);
        const mainWorktree = worktrees.find((w) => w.is_main);
        if (!mainWorktree) {
          throw new Error("Could not find main worktree");
        }
        effectiveBranch = mainWorktree.branch;
      } else {
        effectiveBranch = fixedBranch ?? branch;
        if (!fixedBranch && !importMode && autoGenerate) {
          const inputs =
            Object.keys(inputValues).length > 0 ? inputValues : undefined;
          const result = await generateBranchName(selectedWorkflow, inputs);
          effectiveBranch = result.branch;
        }
        if (!fixedBranch) {
          await createWorktree(organization, name, { branch: effectiveBranch });
        }
      }
      const run = await createWorkflowRun({
        organization,
        name,
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
                setInputValues(
                  wf === initialWorkflow ? initialInputValues : {},
                );
              }}
              inputValues={inputValues}
              onInputChange={(inputName, value) =>
                setInputValues((prev) => ({ ...prev, [inputName]: value }))
              }
              onSubmit={handleSubmit}
              disabled={submitting}
              submitDisabled={
                submitting ||
                (!runsOnMain &&
                  !importMode &&
                  !autoGenerate &&
                  !branch.trim()) ||
                (!runsOnMain && importMode && !branch)
              }
              isSubmitting={submitting}
              submitLabel="Create & launch"
              submittingLabel="Launching…"
              idPrefix="rwm"
              afterWorkflowSelector={
                !runsOnMain && (
                  <div className={styles.fieldGroup}>
                    <label htmlFor="rwm-branch" className={styles.label}>
                      Branch name
                      {!fixedBranch && !autoGenerate && !importMode && (
                        <span className={styles.required}>*</span>
                      )}
                    </label>
                    {fixedBranch ? (
                      <span className={styles.fixedValue}>{fixedBranch}</span>
                    ) : importMode ? (
                      <>
                        {remoteBranchesLoading && (
                          <p className={styles.status}>
                            Loading remote branches…
                          </p>
                        )}
                        {!remoteBranchesLoading && (
                          <select
                            id="rwm-branch"
                            className={styles.select}
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            disabled={submitting}
                            aria-label="Branch name"
                          >
                            {availableRemoteBranches.map((rb) => (
                              <option key={rb.branch} value={rb.branch}>
                                {rb.branch} — PR #{rb.pr_number}: {rb.pr_title}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={exitImportMode}
                          disabled={submitting}
                        >
                          Back to auto-generate
                        </button>
                      </>
                    ) : (
                      <>
                        <div className={styles.checkboxRow}>
                          <label>
                            <input
                              type="checkbox"
                              checked={autoGenerate}
                              onChange={(e) => {
                                setAutoGenerate(e.target.checked);
                                if (e.target.checked) setBranch("");
                              }}
                              disabled={submitting}
                              aria-label="Auto-generate"
                            />
                            <span className={styles.checkboxLabel}>
                              Auto-generate
                            </span>
                          </label>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={enterImportMode}
                            disabled={submitting}
                          >
                            Import remote branch
                          </button>
                        </div>
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
                )
              }
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
            </WorkflowLaunchForm>
          )}

        {submitError && <p className={styles.error}>{submitError}</p>}
      </div>
    </div>
  );
}
