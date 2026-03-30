"use client";

import type { WorkflowDefinition } from "@/lib/utils/api";
import styles from "./WorkflowLaunchForm.module.css";

interface Props {
  /** Extra fields (e.g. branch name) rendered at the top of the form, before the workflow selector. */
  children?: React.ReactNode;
  workflowNames: string[];
  workflows: Record<string, WorkflowDefinition>;
  selectedWorkflow: string;
  onWorkflowChange: (workflow: string) => void;
  inputValues: Record<string, string>;
  onInputChange: (name: string, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  /** Whether all form inputs should be disabled (e.g. while submitting). */
  disabled?: boolean;
  /** Whether the submit button should be disabled. Defaults to `disabled`. */
  submitDisabled?: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  /** Prefix for generated element IDs; ensures uniqueness when multiple forms exist on a page. */
  idPrefix?: string;
}

export default function WorkflowLaunchForm({
  children,
  workflowNames,
  workflows,
  selectedWorkflow,
  onWorkflowChange,
  inputValues,
  onInputChange,
  onSubmit,
  disabled = false,
  submitDisabled,
  isSubmitting,
  submitLabel,
  submittingLabel,
  idPrefix = "wlf",
}: Props) {
  const isSubmitDisabled = submitDisabled ?? disabled;

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      {children}

      <div className={styles.fieldGroup}>
        <label htmlFor={`${idPrefix}-workflow`} className={styles.label}>
          Workflow
        </label>
        <select
          id={`${idPrefix}-workflow`}
          className={styles.select}
          value={selectedWorkflow}
          onChange={(e) => onWorkflowChange(e.target.value)}
          disabled={disabled}
        >
          {workflowNames.map((wfName) => (
            <option key={wfName} value={wfName}>
              {wfName}
            </option>
          ))}
        </select>
      </div>

      {selectedWorkflow &&
        (workflows[selectedWorkflow]?.inputs ?? []).map((inputDef) => (
          <div key={inputDef.name} className={styles.fieldGroup}>
            <label
              htmlFor={`${idPrefix}-input-${inputDef.name}`}
              className={styles.label}
            >
              {inputDef.label}
              {inputDef.required !== false && (
                <span className={styles.required}>*</span>
              )}
            </label>
            {inputDef.description && (
              <span className={styles.description}>{inputDef.description}</span>
            )}
            <input
              id={`${idPrefix}-input-${inputDef.name}`}
              type="text"
              className={styles.input}
              value={inputValues[inputDef.name] ?? ""}
              onChange={(e) => onInputChange(inputDef.name, e.target.value)}
              disabled={disabled}
              placeholder={inputDef.label}
              required={inputDef.required !== false}
            />
          </div>
        ))}

      <button
        type="submit"
        className={styles.submitButton}
        disabled={isSubmitDisabled}
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
