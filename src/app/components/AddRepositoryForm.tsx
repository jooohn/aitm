"use client";

import { useState } from "react";
import { addRepository, type Repository } from "@/lib/api";
import styles from "./AddRepositoryForm.module.css";

interface Props {
	onAdd: (repo: Repository) => void;
}

export default function AddRepositoryForm({ onAdd }: Props) {
	const [path, setPath] = useState("");
	const [name, setName] = useState("");
	const [mainBranch, setMainBranch] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const repo = await addRepository({
				path,
				name: name || undefined,
				main_branch: mainBranch || undefined,
			});
			setPath("");
			setName("");
			setMainBranch("");
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
			<div className={styles.fieldRow}>
				<div className={styles.fieldGroup} style={{ flex: 1 }}>
					<label htmlFor="name" className={styles.label}>
						Name
					</label>
					<input
						id="name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="defaults to directory name"
						disabled={submitting}
						className={styles.input}
					/>
				</div>
				<div className={styles.fieldGroup} style={{ flex: 1 }}>
					<label htmlFor="main-branch" className={styles.label}>
						Main branch
					</label>
					<input
						id="main-branch"
						type="text"
						value={mainBranch}
						onChange={(e) => setMainBranch(e.target.value)}
						placeholder="defaults to main"
						disabled={submitting}
						className={styles.input}
					/>
				</div>
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
