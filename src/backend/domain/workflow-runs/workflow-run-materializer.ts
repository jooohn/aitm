import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { WorkflowArtifact } from "@/backend/infra/config";
import {
  resolveArtifactBasePath,
  resolveWorkflowRunDir,
  type Worktree,
  type WorktreeService,
} from "../worktrees";
import type { WorkflowRunRepository } from "./workflow-run-repository";

type GitExcludeManagerDeps = {
  resolveGitInfoDir(worktreePath: string): Promise<string>;
  ensureExcludeEntry(infoDir: string, entry: string): Promise<void>;
};

function buildCommandOutputHandoffSummary(
  reason: string | undefined,
  outputFilePath: string,
): string {
  const summaryPrefix =
    reason && reason.trim().length > 0 ? reason : "Command completed";
  return `${summaryPrefix}. Detailed output: ${outputFilePath}`;
}

export class WorkflowRunMaterializer {
  constructor(
    private workflowRunRepository: Pick<
      WorkflowRunRepository,
      | "getWorkflowRunById"
      | "listLegacyCommandOutputBackfillCandidates"
      | "backfillLegacyCommandOutput"
    >,
    private worktreeService: Pick<WorktreeService, "findWorktree">,
    private gitExcludeManager: GitExcludeManagerDeps,
  ) {}

  async ensureWorkflowRunDir(
    workflowRunId: string,
    worktree: Worktree,
  ): Promise<void> {
    const runDir = resolveWorkflowRunDir(worktree, workflowRunId);
    await mkdir(runDir, { recursive: true });

    const infoDir = await this.gitExcludeManager.resolveGitInfoDir(
      worktree.path,
    );
    const excludeEntry = `/.aitm/runs/${workflowRunId}/`;
    await this.gitExcludeManager.ensureExcludeEntry(infoDir, excludeEntry);
  }

  async materializeWorkflowArtifacts(
    workflowRunId: string,
    artifacts: WorkflowArtifact[],
    worktree: Worktree,
  ): Promise<void> {
    if (artifacts.length === 0) return;

    const root = resolveArtifactBasePath(worktree, workflowRunId);
    await mkdir(root, { recursive: true });

    for (const artifact of artifacts) {
      const artifactPath = join(root, artifact.path);
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, "", { encoding: "utf8", flag: "a" });
    }
  }

  async ensureLegacyCommandOutputFiles(workflowRunId: string): Promise<void> {
    const run = this.workflowRunRepository.getWorkflowRunById(workflowRunId);
    if (!run) return;

    const candidates =
      this.workflowRunRepository.listLegacyCommandOutputBackfillCandidates(
        workflowRunId,
      );
    if (candidates.length === 0) return;

    const worktree = await this.worktreeService.findWorktree(
      run.repository_path,
      run.worktree_branch,
    );
    if (!worktree) return;

    const outputDir = join(
      resolveWorkflowRunDir(worktree, workflowRunId),
      "command-outputs",
    );
    await this.ensureWorkflowRunDir(workflowRunId, worktree);
    await mkdir(outputDir, { recursive: true });

    for (const candidate of candidates) {
      const outputFilePath = join(outputDir, `${candidate.id}.log`);
      await writeFile(outputFilePath, candidate.command_output, "utf8");

      const handoffSummary = buildCommandOutputHandoffSummary(
        candidate.transition_decision?.reason,
        outputFilePath,
      );
      const transitionDecisionJson = candidate.transition_decision
        ? JSON.stringify({
            ...candidate.transition_decision,
            handoff_summary: handoffSummary,
          })
        : null;

      this.workflowRunRepository.backfillLegacyCommandOutput({
        id: candidate.id,
        output_file_path: outputFilePath,
        handoff_summary: handoffSummary,
        transition_decision_json: transitionDecisionJson,
      });
    }
  }
}
