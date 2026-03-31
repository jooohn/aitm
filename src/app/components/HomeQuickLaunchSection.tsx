"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createWorkflowRun,
  createWorktree,
  fetchRepositories,
  fetchWorkflows,
  type Repository,
  type WorkflowDefinition,
} from "@/lib/utils/api";
import styles from "./HomeQuickLaunchSection.module.css";
import WorkflowLaunchForm from "./WorkflowLaunchForm";

export default function HomeQuickLaunchSection() {
  const router = useRouter();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedAlias, setSelectedAlias] = useState("");
  const [branch, setBranch] = useState("");
  const [workflows, setWorkflows] = useState<
    Record<string, WorkflowDefinition>
  >({});
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [repoList, wfs] = await Promise.all([
          fetchRepositories(),
          fetchWorkflows(),
        ]);
        setRepos(repoList);
        if (repoList.length > 0) setSelectedAlias(repoList[0].alias);
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
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch.trim() || !selectedWorkflow || !selectedAlias) return;
    const repo = repos.find((r) => r.alias === selectedAlias);
    if (!repo) return;
    const [organization, name] = repo.alias.split("/");
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createWorktree(organization, name, { branch });
      const run = await createWorkflowRun({
        repository_path: repo.path,
        worktree_branch: branch,
        workflow_name: selectedWorkflow,
        inputs: Object.keys(inputValues).length > 0 ? inputValues : undefined,
      });
      router.push(`/workflow-runs/${run.id}`);
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
    <section className={styles.section}>
      <h2 className={styles.heading}>Quick launch</h2>

      {loading && <p className={styles.status}>Loading…</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && repos.length === 0 && (
        <p className={styles.status}>
          No repositories configured. Add entries to{" "}
          <code className={styles.code}>~/.aitm/config.yaml</code>.
        </p>
      )}

      {!loading &&
        !loadError &&
        repos.length > 0 &&
        workflowNames.length === 0 && (
          <p className={styles.status}>
            No workflows configured. Add workflows to{" "}
            <code className={styles.code}>~/.aitm/config.yaml</code>.
          </p>
        )}

      {!loading &&
        !loadError &&
        repos.length > 0 &&
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
            idPrefix="hql"
          >
            <div className={styles.fieldGroup}>
              <label htmlFor="hql-repo" className={styles.label}>
                Repository
                <span className={styles.required}>*</span>
              </label>
              <select
                id="hql-repo"
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
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="hql-branch" className={styles.label}>
                Branch name
                <span className={styles.required}>*</span>
              </label>
              <input
                id="hql-branch"
                type="text"
                className={styles.input}
                placeholder="e.g. feature/my-change"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
          </WorkflowLaunchForm>
        )}

      {submitError && <p className={styles.error}>{submitError}</p>}
    </section>
  );
}
