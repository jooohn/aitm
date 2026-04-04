"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowBreadcrumb from "@/app/components/WorkflowBreadcrumb";
import WorkflowKanbanBoard from "@/app/components/WorkflowKanbanBoard";
import WorkflowLaunchForm from "@/app/components/WorkflowLaunchForm";
import WorktreeSection from "@/app/components/WorktreeSection";
import {
  createWorkflowRun,
  createWorktree,
  fetchRepository,
  fetchWorkflows,
  fetchWorktrees,
  type RepositoryDetail,
  type WorkflowDefinition,
} from "@/lib/utils/api";
import styles from "./page.module.css";

export default function RepositoryPage() {
  const router = useRouter();
  const { organization, name } = useParams<{
    organization: string;
    name: string;
  }>();
  const alias = `${organization}/${name}`;
  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [activeWorktreeBranches, setActiveWorktreeBranches] = useState<
    string[] | null
  >(null);
  const [loading, setLoading] = useState(true);

  // Launch form state
  const [workflows, setWorkflows] = useState<
    Record<string, WorkflowDefinition>
  >({});
  const [wfLoading, setWfLoading] = useState(true);
  const [wfError, setWfError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchRepository(organization, name),
      fetchWorktrees(organization, name).catch(() => null),
    ])
      .then(([r, worktrees]) => {
        setRepo(r);
        if (worktrees) {
          setActiveWorktreeBranches(
            worktrees.map((w) => w.branch).filter(Boolean),
          );
        }
      })
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [organization, name]);

  useEffect(() => {
    fetchWorkflows()
      .then((wfs) => {
        setWorkflows(wfs);
        const names = Object.keys(wfs);
        if (names.length > 0) {
          setSelectedWorkflow(names[0]);
        }
      })
      .catch((err) => {
        setWfError(
          err instanceof Error ? err.message : "Failed to load workflows",
        );
      })
      .finally(() => setWfLoading(false));
  }, []);

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!branch.trim() || !selectedWorkflow || !repo) return;
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

  if (loading) return null;
  if (!repo) return notFound();

  const workflowNames = Object.keys(workflows);

  return (
    <main className={styles.page}>
      <div className={styles.headingRow}>
        <h1 className={styles.heading}>{alias}</h1>
        {repo.github_url && (
          <a
            href={repo.github_url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.githubLink}
            aria-label="Open on GitHub"
          >
            <svg
              viewBox="0 0 16 16"
              width="20"
              height="20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        )}
      </div>
      <dl className={styles.details}>
        <div className={styles.row}>
          <dt className={styles.label}>Path</dt>
          <dd className={styles.value}>{repo.path}</dd>
        </div>
      </dl>
      <div className={styles.mainLayout}>
        <div className={styles.kanbanPane}>
          <WorkflowKanbanBoard
            repositoryPath={repo.path}
            activeWorktreeBranches={activeWorktreeBranches}
          />
        </div>
        <aside className={styles.launchPane}>
          <h2 className={styles.launchHeading}>Launch new Workflow</h2>
          {wfLoading && <p>Loading...</p>}
          {wfError && <p className={styles.error}>{wfError}</p>}
          {!wfLoading && !wfError && workflowNames.length > 0 && (
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
              onSubmit={handleLaunch}
              disabled={submitting}
              submitDisabled={submitting || !branch.trim()}
              isSubmitting={submitting}
              submitLabel="Create & launch"
              submittingLabel="Launching..."
              idPrefix="lp"
            >
              <div>
                <label htmlFor="lp-branch">
                  Branch name
                  <span>*</span>
                </label>
                <input
                  id="lp-branch"
                  type="text"
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
        </aside>
      </div>
      <WorktreeSection organization={organization} name={name} />
    </main>
  );
}
