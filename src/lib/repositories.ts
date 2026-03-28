import { existsSync } from "fs";
import { basename, join } from "path";
import { db } from "./db";

export interface Repository {
  id: number;
  path: string;
  name: string;
  main_branch: string;
  created_at: string;
}

export interface RegisterInput {
  path: string;
  name?: string;
  main_branch?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, ".git"));
}

export function registerRepository(input: RegisterInput): Repository {
  const { path, name = basename(path), main_branch = "main" } = input;

  if (!existsSync(path)) {
    throw new Error(`Path does not exist: ${path}`);
  }
  if (!isGitRepo(path)) {
    throw new Error(`Path is not a git repository: ${path}`);
  }

  const existing = db
    .prepare("SELECT id FROM repositories WHERE path = ?")
    .get(path);
  if (existing) {
    throw new Error(`Path is already registered: ${path}`);
  }

  const created_at = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO repositories (path, name, main_branch, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(path, name, main_branch, created_at);

  return db
    .prepare("SELECT * FROM repositories WHERE id = ?")
    .get(result.lastInsertRowid) as Repository;
}

export function listRepositories(): Repository[] {
  return db
    .prepare("SELECT * FROM repositories ORDER BY name ASC")
    .all() as Repository[];
}

export function removeRepository(id: number): void {
  const existing = db
    .prepare("SELECT id FROM repositories WHERE id = ?")
    .get(id);
  if (!existing) {
    throw new Error(`Repository not found: ${id}`);
  }
  db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
}

export function validateRepository(id: number): ValidationResult {
  const repo = db
    .prepare("SELECT * FROM repositories WHERE id = ?")
    .get(id) as Repository | undefined;
  if (!repo) {
    throw new Error(`Repository not found: ${id}`);
  }

  if (!existsSync(repo.path)) {
    return { valid: false, reason: "Path does not exist" };
  }
  if (!isGitRepo(repo.path)) {
    return { valid: false, reason: "Path is not a git repository" };
  }
  return { valid: true };
}
