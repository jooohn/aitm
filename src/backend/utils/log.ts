import { appendFile } from "node:fs/promises";

export async function appendToLog(
  logFilePath: string,
  entry: unknown,
): Promise<void> {
  try {
    await appendFile(logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Non-critical — ignore log write errors.
  }
}
