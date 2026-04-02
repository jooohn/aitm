import Database from "better-sqlite3";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

const dbPath = process.env.AITM_DB_PATH ?? join(homedir(), ".aitm", "aitm.db");

if (dbPath !== ":memory:") {
  await mkdir(dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);
