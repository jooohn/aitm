"use client";

import Link from "next/link";
import { useState } from "react";
import {
  type Repository,
  removeRepository,
  validateRepository,
} from "@/lib/api";
import styles from "./RepositoryRow.module.css";

interface Props {
  repo: Repository;
  onRemove: (id: number) => void;
}

type ValidationStatus = "idle" | "loading" | "valid" | "invalid";

export default function RepositoryRow({ repo, onRemove }: Props) {
  const [validationStatus, setValidationStatus] =
    useState<ValidationStatus>("idle");
  const [validationReason, setValidationReason] = useState<string | undefined>(
    undefined,
  );
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleValidate() {
    setValidationStatus("loading");
    try {
      const result = await validateRepository(repo.id);
      setValidationStatus(result.valid ? "valid" : "invalid");
      setValidationReason(result.reason);
    } catch {
      setValidationStatus("idle");
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove "${repo.path}" from aitm?`)) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeRepository(repo.id);
      onRemove(repo.id);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Unknown error");
      setRemoving(false);
    }
  }

  return (
    <li className={styles.item}>
      <div className={styles.info}>
        <Link href={`/repositories/${repo.alias}`} className={styles.alias}>
          {repo.alias}
        </Link>
        <span className={styles.path}>{repo.path}</span>
        {removeError && <p className={styles.removeError}>{removeError}</p>}
      </div>
      <div className={styles.actions}>
        {validationStatus === "valid" && (
          <span className={styles.validBadge}>Valid</span>
        )}
        {validationStatus === "invalid" && (
          <span className={styles.invalidBadge} title={validationReason}>
            {validationReason ?? "Invalid"}
          </span>
        )}
        <button
          type="button"
          onClick={handleValidate}
          disabled={validationStatus === "loading" || removing}
          className={styles.validateButton}
        >
          {validationStatus === "loading" ? "Checking…" : "Validate"}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className={styles.removeButton}
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </li>
  );
}
