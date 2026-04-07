"use client";

import Link from "next/link";
import { useState } from "react";
import { type Repository, validateRepository } from "@/lib/utils/api";
import styles from "./RepositoryRow.module.css";

interface Props {
  repo: Repository;
}

type ValidationStatus = "idle" | "loading" | "valid" | "invalid";

export default function RepositoryRow({ repo }: Props) {
  const [validationStatus, setValidationStatus] =
    useState<ValidationStatus>("idle");
  const [validationReason, setValidationReason] = useState<string | undefined>(
    undefined,
  );

  async function handleValidate() {
    setValidationStatus("loading");
    const [organization, name] = repo.alias.split("/");
    try {
      const result = await validateRepository(organization, name);
      setValidationStatus(result.valid ? "valid" : "invalid");
      setValidationReason(result.reason);
    } catch {
      setValidationStatus("idle");
    }
  }

  return (
    <li className={styles.item}>
      <div className={styles.info}>
        <Link href={`/repositories/${repo.alias}`} className={styles.alias}>
          {repo.alias}
        </Link>
        <span className={styles.path}>{repo.path}</span>
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
          disabled={validationStatus === "loading"}
          className={styles.validateButton}
        >
          {validationStatus === "loading" ? "Checking…" : "Validate"}
        </button>
      </div>
    </li>
  );
}
