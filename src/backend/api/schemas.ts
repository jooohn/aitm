import { z } from "zod";
import type { SessionStatus } from "@/backend/domain/sessions";
import type { WorkflowRunStatus } from "@/backend/domain/workflow-runs";

const requiredString = (field: string) =>
  z.string().trim().min(1, `${field} is required`);

const stringRecordSchema = z.custom<Record<string, string>>(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    return Object.values(value as Record<string, unknown>).every(
      (entry) => typeof entry === "string",
    );
  },
  {
    message: "inputs must be an object with string values",
  },
);
const optionalNullableStringRecordSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  stringRecordSchema.optional(),
);
const optionalBlankStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim() === "" ? undefined : value;
}, z.string().trim().min(1).optional());

export const chatCreateBodySchema = z.object({
  organization: requiredString("organization"),
  name: requiredString("name"),
});

export const branchNameGenerateBodySchema = z.object({
  workflow_name: requiredString("workflow_name"),
  inputs: optionalNullableStringRecordSchema,
});

export const workflowRunCreateBodySchema = z.object({
  organization: requiredString("organization"),
  name: requiredString("name"),
  worktree_branch: requiredString("worktree_branch"),
  workflow_name: requiredString("workflow_name"),
  inputs: optionalNullableStringRecordSchema,
});

export const worktreeCreateBodySchema = z.object({
  branch: requiredString("branch"),
  name: optionalBlankStringSchema,
  no_fetch: z.boolean().optional(),
});

export const processCreateBodySchema = z.object({
  command_id: z
    .string()
    .trim()
    .min(1, "command_id is required and must be non-empty"),
});

const optionalString = z.string().optional();

export const chatListQuerySchema = z.object({
  organization: optionalString,
  name: optionalString,
});

export const workflowRunStatuses = [
  "running",
  "awaiting",
  "success",
  "failure",
] as const satisfies readonly WorkflowRunStatus[];

export const workflowRunListQuerySchema = z.object({
  organization: optionalString,
  name: optionalString,
  worktree_branch: optionalString,
  status: z
    .enum(workflowRunStatuses, {
      error: `status must be one of ${workflowRunStatuses.join(", ")}`,
    })
    .optional(),
});

export const sessionStatuses = [
  "running",
  "awaiting_input",
  "success",
  "failure",
] as const satisfies readonly SessionStatus[];

export const sessionListQuerySchema = z.object({
  organization: optionalString,
  name: optionalString,
  worktree_branch: optionalString,
  status: z
    .enum(sessionStatuses, {
      error: `status must be one of ${sessionStatuses.join(", ")}`,
    })
    .optional(),
});
