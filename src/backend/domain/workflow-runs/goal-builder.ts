import { join } from "path";
import type { WorkflowArtifact } from "@/backend/infra/config";
import type { PreviousExecutionHandoff } from "./workflow-run-repository";

export function resolveWorkflowArtifacts(
  workflowRunId: string,
  worktreePath: string,
  artifacts?: WorkflowArtifact[],
): Array<{ name: string; path: string; description?: string }> {
  if (!artifacts || artifacts.length === 0) return [];

  const artifactRoot = join(
    worktreePath,
    ".aitm",
    "runs",
    workflowRunId,
    "artifacts",
  );
  return artifacts.map((artifact) => ({
    name: artifact.name,
    path: join(artifactRoot, artifact.path),
    description: artifact.description,
  }));
}

export function buildGoal(
  stepGoal: string,
  previousExecutions: PreviousExecutionHandoff[],
  artifacts: Array<{ name: string; path: string; description?: string }>,
  inputs?: Record<string, string>,
): string {
  const parts = ["<goal>", stepGoal, "</goal>"];

  if (
    previousExecutions.length === 0 &&
    inputs &&
    Object.keys(inputs).length > 0
  ) {
    parts.push("", "<inputs>");
    for (const [key, value] of Object.entries(inputs)) {
      parts.push(`${key}: ${value}`);
    }
    parts.push("</inputs>");
  }

  if (artifacts.length > 0) {
    parts.push("", "<artifacts>");
    for (const artifact of artifacts) {
      parts.push(`Artifact: ${artifact.name}`, `Path: ${artifact.path}`);
      if (artifact.description) {
        parts.push(`Description: ${artifact.description}`);
      }
      parts.push("");
    }
    parts.push("</artifacts>");
  }

  if (previousExecutions.length > 0) {
    parts.push("", "<handoff>", "Previous steps (oldest first):", "");
    for (const prev of previousExecutions) {
      parts.push(`Step: ${prev.step}`, `Summary: ${prev.handoff_summary}`);
      if (prev.log_file_path) {
        parts.push(`Log: ${prev.log_file_path}`);
      }
      if (prev.output_file_path) {
        parts.push(`Output: ${prev.output_file_path}`);
      }
      parts.push("");
    }
    parts.push("</handoff>");
  }

  return parts.join("\n");
}
