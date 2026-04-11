import { readFile } from "fs/promises";
import { basename, resolve, sep } from "path";
import { getContainer } from "@/backend/container";
import { resolveWorkflowRunDir } from "../worktrees";

export interface WorkflowRunCommandOutput {
  filename: string;
  content: string;
}

export async function getWorkflowRunCommandOutput(
  workflowRunId: string,
  filename: string,
): Promise<WorkflowRunCommandOutput | null> {
  const { workflowRunService, worktreeService } = getContainer();
  const run = await workflowRunService.getWorkflowRunForDisplay(workflowRunId);
  if (!run) return null;

  const matches = run.step_executions.filter(
    (execution) =>
      execution.step_type === "command" &&
      execution.output_file_path &&
      basename(execution.output_file_path) === filename,
  );
  if (matches.length !== 1) return null;

  const outputFilePath = matches[0].output_file_path;
  if (!outputFilePath) return null;

  const worktree = await worktreeService.findWorktree(
    run.repository_path,
    run.worktree_branch,
  );
  if (!worktree) return null;

  const outputPath = resolve(outputFilePath);
  const runDir = resolve(resolveWorkflowRunDir(worktree, run.id));
  const allowedRoot = `${runDir}${sep}`;
  if (outputPath !== runDir && !outputPath.startsWith(allowedRoot)) {
    return null;
  }

  const content = await readFile(outputPath, "utf8").catch(() => null);
  if (content === null) return null;

  return { filename, content };
}
