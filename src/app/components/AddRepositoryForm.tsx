"use client";

import { useState } from "react";
import { addRepository, type Repository } from "@/lib/api";
import styles from "./AddRepositoryForm.module.css";

interface Props {
  onAdd: (repo: Repository) => void;
}

export default function AddRepositoryForm({ onAdd }: Props) {
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const repo = await addRepository({ path });
      setPath("");
      onAdd(repo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h2 className={styles.title}>Add repository</h2>
      <div className={styles.fieldGroup}>
        <label htmlFor="path" className={styles.label}>
          Path <span className={styles.required}>*</span>
        </label>
        <input
          id="path"
          type="text"
          required
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setError(null);
          }}
          placeholder="/absolute/path/to/repo"
          disabled={submitting}
          className={styles.input}
        />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className={styles.submitButton}
      >
        {submitting ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
