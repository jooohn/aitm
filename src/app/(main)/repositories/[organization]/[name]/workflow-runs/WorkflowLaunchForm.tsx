"use client";

import Button from "@/app/components/Button";
import LoadingIndicator from "@/app/components/LoadingIndicator";
import type { WorkflowDefinition } from "@/lib/utils/api";
import styles from "./WorkflowLaunchForm.module.css";

interface Props {
  /** Extra fields (e.g. repository) rendered at the top of the form, before the workflow selector. */
  children?: React.ReactNode;
  /** Extra fields (e.g. branch name) rendered between the workflow selector and the workflow inputs. */
  afterWorkflowSelector?: React.ReactNode;
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
  afterWorkflowSelector,
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
  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (
      event.key === "Enter" &&
      event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      !isSubmitDisabled
    ) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <form onSubmit={onSubmit} onKeyDown={handleKeyDown} className={styles.form}>
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
              {workflows[wfName]?.label ?? wfName}
            </option>
          ))}
        </select>
      </div>

      {afterWorkflowSelector}

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
            {inputDef.type === "multiline-text" ? (
              <textarea
                id={`${idPrefix}-input-${inputDef.name}`}
                className={styles.input}
                value={inputValues[inputDef.name] ?? ""}
                onChange={(e) => onInputChange(inputDef.name, e.target.value)}
                disabled={disabled}
                placeholder={inputDef.label}
                required={inputDef.required !== false}
              />
            ) : (
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
            )}
          </div>
        ))}

      <Button
        type="submit"
        variant="primary"
        className={styles.submitButton}
        disabled={isSubmitDisabled}
      >
        {isSubmitting ? (
          <>
            <LoadingIndicator testId="submit-spinner" />
            {submittingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}
