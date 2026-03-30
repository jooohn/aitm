"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createWorkflowRun,
  createWorktree,
  fetchWorkflows,
  type WorkflowDefinition,
} from "@/lib/utils/api";
import styles from "./QuickLaunchSection.module.css";
import WorkflowLaunchForm from "./WorkflowLaunchForm";

interface Props {
  organization: string;
  name: string;
  repositoryPath: string;
}

export default function QuickLaunchSection({
  organization,
  name,
  repositoryPath,
}: Props) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Record<string, WorkflowDefinition>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const wfs = await fetchWorkflows();
        setWorkflows(wfs);
        const names = Object.keys(wfs);
        if (names.length > 0) {
          setSelectedWorkflow(names[0]);
          setInputValues({});
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load workflows",
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch.trim() || !selectedWorkflow) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createWorktree(organization, name, { branch });
      const run = await createWorkflowRun({
        repository_path: repositoryPath,
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

      {!loading && !loadError && workflowNames.length === 0 && (
        <p className={styles.status}>
          No workflows configured. Add workflows to{" "}
          <code className={styles.code}>~/.aitm/config.yaml</code>.
        </p>
      )}

      {!loading && !loadError && workflowNames.length > 0 && (
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
          idPrefix="ql"
        >
          <div className={styles.fieldGroup}>
            <label htmlFor="ql-branch" className={styles.label}>
              Branch name
              <span className={styles.required}>*</span>
            </label>
            <input
              id="ql-branch"
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
