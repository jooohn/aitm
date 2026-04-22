import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowArtifact,
  WorkflowDefinition,
} from "@/backend/infra/config";
import type { Worktree } from "../worktrees";
import { WorkflowRunMaterializer } from "./workflow-run-materializer";

function makeWorktree(path: string): Worktree {
  return {
    branch: "feat/test",
    path,
    is_main: false,
    is_bare: false,
    head: "abc1234",
  };
}

describe("WorkflowRunMaterializer", () => {
  let tempDir: string;
  let worktree: Worktree;
  let materializer: WorkflowRunMaterializer;
  let mockWorkflowRunRepository: {
    getWorkflowRunById: ReturnType<typeof vi.fn>;
    listLegacyCommandOutputBackfillCandidates: ReturnType<typeof vi.fn>;
    backfillLegacyCommandOutput: ReturnType<typeof vi.fn>;
  };
  let mockWorktreeService: {
    findWorktree: ReturnType<typeof vi.fn>;
  };
  let mockGitExcludeManager: {
    resolveGitInfoDir: ReturnType<typeof vi.fn>;
    ensureExcludeEntry: ReturnType<typeof vi.fn>;
    removeExcludeEntry: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `aitm-materializer-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    worktree = makeWorktree(tempDir);

    mockWorkflowRunRepository = {
      getWorkflowRunById: vi.fn(),
      listLegacyCommandOutputBackfillCandidates: vi.fn().mockReturnValue([]),
      backfillLegacyCommandOutput: vi.fn(),
    };
    mockWorktreeService = {
      findWorktree: vi.fn().mockResolvedValue(worktree),
    };
    mockGitExcludeManager = {
      resolveGitInfoDir: vi
        .fn()
        .mockResolvedValue(join(tempDir, ".git", "info")),
      ensureExcludeEntry: vi.fn().mockResolvedValue(undefined),
      removeExcludeEntry: vi.fn().mockResolvedValue(undefined),
    };

    materializer = new WorkflowRunMaterializer(
      mockWorkflowRunRepository as never,
      mockWorktreeService as never,
      mockGitExcludeManager as never,
    );
  });

  describe("ensureWorkflowRunDir", () => {
    it("creates the .aitm/runs/<id>/ directory", async () => {
      await materializer.ensureWorkflowRunDir("run-1", worktree);

      const runDir = join(tempDir, ".aitm", "runs", "run-1");
      const s = await stat(runDir);
      expect(s.isDirectory()).toBe(true);
    });

    it("adds an exclude entry for the run directory", async () => {
      await materializer.ensureWorkflowRunDir("run-1", worktree);

      expect(mockGitExcludeManager.resolveGitInfoDir).toHaveBeenCalledWith(
        tempDir,
      );
      expect(mockGitExcludeManager.ensureExcludeEntry).toHaveBeenCalledWith(
        join(tempDir, ".git", "info"),
        "/.aitm/runs/run-1/",
      );
    });
  });

  describe("materializeWorkflowArtifacts", () => {
    it("creates empty artifact files at expected paths", async () => {
      const artifacts: WorkflowArtifact[] = [
        { name: "plan", path: "plan.md", description: "The plan" },
        { name: "notes", path: "sub/notes.txt" },
      ];

      await materializer.materializeWorkflowArtifacts(
        "run-1",
        artifacts,
        worktree,
      );

      const artifactRoot = join(tempDir, ".aitm", "runs", "run-1", "artifacts");
      const plan = await readFile(join(artifactRoot, "plan.md"), "utf8");
      expect(plan).toBe("");
      const notes = await readFile(
        join(artifactRoot, "sub", "notes.txt"),
        "utf8",
      );
      expect(notes).toBe("");
    });

    it("does nothing when artifacts list is empty", async () => {
      await materializer.materializeWorkflowArtifacts("run-1", [], worktree);

      await expect(
        stat(join(tempDir, ".aitm", "runs", "run-1", "artifacts")),
      ).rejects.toThrow();
    });

    it("does not overwrite existing artifact files", async () => {
      const artifactRoot = join(tempDir, ".aitm", "runs", "run-1", "artifacts");
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(
        join(artifactRoot, "plan.md"),
        "existing content",
        "utf8",
      );

      await materializer.materializeWorkflowArtifacts(
        "run-1",
        [{ name: "plan", path: "plan.md" }],
        worktree,
      );

      const content = await readFile(join(artifactRoot, "plan.md"), "utf8");
      expect(content).toBe("existing content");
    });
  });

  describe("ensureLegacyCommandOutputFiles", () => {
    it("returns early when no workflow run found", async () => {
      mockWorkflowRunRepository.getWorkflowRunById.mockReturnValue(undefined);

      await materializer.ensureLegacyCommandOutputFiles("run-1");

      expect(
        mockWorkflowRunRepository.listLegacyCommandOutputBackfillCandidates,
      ).not.toHaveBeenCalled();
    });

    it("returns early when no candidates exist", async () => {
      mockWorkflowRunRepository.getWorkflowRunById.mockReturnValue({
        id: "run-1",
        repository_path: "/tmp/repo",
        worktree_branch: "feat/test",
      });
      mockWorkflowRunRepository.listLegacyCommandOutputBackfillCandidates.mockReturnValue(
        [],
      );

      await materializer.ensureLegacyCommandOutputFiles("run-1");

      expect(mockWorktreeService.findWorktree).not.toHaveBeenCalled();
    });

    it("writes command output files and calls backfill for each candidate", async () => {
      mockWorkflowRunRepository.getWorkflowRunById.mockReturnValue({
        id: "run-1",
        repository_path: "/tmp/repo",
        worktree_branch: "feat/test",
      });
      mockWorkflowRunRepository.listLegacyCommandOutputBackfillCandidates.mockReturnValue(
        [
          {
            id: "exec-1",
            command_output: "output content",
            transition_decision: {
              transition: "next",
              reason: "Command succeeded",
            },
          },
        ],
      );

      await materializer.ensureLegacyCommandOutputFiles("run-1");

      const expectedOutputPath = join(
        tempDir,
        ".aitm",
        "runs",
        "run-1",
        "command-outputs",
        "exec-1.log",
      );

      const content = await readFile(expectedOutputPath, "utf8");
      expect(content).toBe("output content");

      expect(
        mockWorkflowRunRepository.backfillLegacyCommandOutput,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "exec-1",
          output_file_path: expectedOutputPath,
          handoff_summary: expect.stringContaining("Command succeeded"),
          transition_decision_json: expect.stringContaining("exec-1.log"),
        }),
      );
    });

    it("returns early when worktree is not found", async () => {
      mockWorkflowRunRepository.getWorkflowRunById.mockReturnValue({
        id: "run-1",
        repository_path: "/tmp/repo",
        worktree_branch: "feat/test",
      });
      mockWorkflowRunRepository.listLegacyCommandOutputBackfillCandidates.mockReturnValue(
        [{ id: "exec-1", command_output: "output", transition_decision: null }],
      );
      mockWorktreeService.findWorktree.mockResolvedValue(undefined);

      await materializer.ensureLegacyCommandOutputFiles("run-1");

      expect(
        mockWorkflowRunRepository.backfillLegacyCommandOutput,
      ).not.toHaveBeenCalled();
    });
  });

  describe("cleanupWorkflowRunDir", () => {
    it("removes the run directory and exclude entry", async () => {
      const runDir = join(tempDir, ".aitm", "runs", "run-1");
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "some-file.txt"), "data", "utf8");

      await materializer.cleanupWorkflowRunDir("run-1", worktree);

      await expect(access(runDir)).rejects.toThrow();
      expect(mockGitExcludeManager.removeExcludeEntry).toHaveBeenCalledWith(
        join(tempDir, ".git", "info"),
        "/.aitm/runs/run-1/",
      );
    });

    it("is idempotent when called twice", async () => {
      const runDir = join(tempDir, ".aitm", "runs", "run-1");
      await mkdir(runDir, { recursive: true });

      await materializer.cleanupWorkflowRunDir("run-1", worktree);
      await materializer.cleanupWorkflowRunDir("run-1", worktree);

      await expect(access(runDir)).rejects.toThrow();
      expect(mockGitExcludeManager.removeExcludeEntry).toHaveBeenCalledTimes(2);
    });

    it("does not throw when directory does not exist", async () => {
      await expect(
        materializer.cleanupWorkflowRunDir("run-nonexistent", worktree),
      ).resolves.toBeUndefined();

      expect(mockGitExcludeManager.removeExcludeEntry).toHaveBeenCalledWith(
        join(tempDir, ".git", "info"),
        "/.aitm/runs/run-nonexistent/",
      );
    });
  });
});
