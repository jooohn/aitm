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
        err instanceof Error ? err.message : "Failed to create worktree or launch workflow",
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
        <form onSubmit={handleSubmit} className={styles.form}>
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

          {workflowNames.length > 1 && (
            <div className={styles.fieldGroup}>
              <label htmlFor="ql-workflow" className={styles.label}>
                Workflow
              </label>
              <select
                id="ql-workflow"
                className={styles.select}
                value={selectedWorkflow}
                onChange={(e) => {
                  setSelectedWorkflow(e.target.value);
                  setInputValues({});
                }}
                disabled={submitting}
              >
                {workflowNames.map((wfName) => (
                  <option key={wfName} value={wfName}>
                    {wfName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedWorkflow &&
            (workflows[selectedWorkflow]?.inputs ?? []).map((inputDef) => (
              <div key={inputDef.name} className={styles.fieldGroup}>
                <label
                  htmlFor={`ql-input-${inputDef.name}`}
                  className={styles.label}
                >
                  {inputDef.label}
                  {inputDef.required !== false && (
                    <span className={styles.required}>*</span>
                  )}
                </label>
                {inputDef.description && (
                  <span className={styles.description}>
                    {inputDef.description}
                  </span>
                )}
                <input
                  id={`ql-input-${inputDef.name}`}
                  type="text"
                  className={styles.input}
                  value={inputValues[inputDef.name] ?? ""}
                  onChange={(e) =>
                    setInputValues((prev) => ({
                      ...prev,
                      [inputDef.name]: e.target.value,
                    }))
                  }
                  disabled={submitting}
                  placeholder={inputDef.label}
                  required={inputDef.required !== false}
                />
              </div>
            ))}

          <button
            type="submit"
            className={styles.launchButton}
            disabled={submitting || !branch.trim()}
          >
            {submitting ? "Launching…" : "Create & launch"}
          </button>
        </form>
      )}

      {submitError && <p className={styles.error}>{submitError}</p>}
    </section>
  );
}
